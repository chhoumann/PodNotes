import { toError } from "src/utility/toError";
import { jsonValuesEqual, mergeDataFile, threeWayMergeSettings } from "./merge";

/** Timers of the main window. A popout's timers stop when the popout closes. */
export interface Clock {
	setTimeout(callback: () => void, ms: number): number;
	clearTimeout(id: number): void;
	now(): number;
}

export class WriteRefusedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WriteRefusedError";
	}
}

export interface Refusal {
	/**
	 * retry: a later read may succeed, as once a sync client finishes its write.
	 * stop: the file has a schema this version must not write; only the next instance reads it.
	 */
	readonly recovery: "retry" | "stop";
	readonly message: string;
}

export type ReadOutcome<Doc> =
	| { readonly kind: "file"; readonly doc: Doc }
	| { readonly kind: "missing" }
	| { readonly kind: "refused"; readonly refusal: Refusal };

/** How the writer reaches data.json and the in-memory state, as plain JSON documents. */
export interface DataFileAccess<Doc> {
	/**
	 * The file now. Entries that had to be dropped to read it are reported as `base`
	 * has them. Rejects only on a defect, which is not retried.
	 */
	read(base: Doc | null): Promise<ReadOutcome<Doc>>;
	write(doc: Doc): Promise<void>;
	/** The in-memory state as the document it would write. */
	local(): Doc;
	/** Replace the in-memory state with a document that came from disk. */
	publish(doc: Doc): void;
}

export type WriterStart<Doc> =
	| { readonly base: Doc }
	| { readonly base: null; readonly refusal: Refusal };

export interface WriterEvents {
	/** A refusal began or changed its reason, or ended (null). */
	onRefusal(refusal: Refusal | null): void;
	/** A save's write failed; once per failure streak. */
	onWriteFailed(): void;
}

// Each save rewrites the whole file, and playback progress changes every few
// seconds, so a progress checkpoint starts at least this long after the last save.
const CHECKPOINT_INTERVAL_MS = 10_000;
// A program writing data.json in place empties the file first. Obsidian waits as
// long before its own check.
const REPORT_SETTLE_MS = 50;

/**
 * Writes data.json without clobbering changes another device synced in. Every
 * save and every external change runs on one promise chain and merges base
 * (what was last loaded or written), memory and disk three ways. Ported from
 * QuickAdd's settings persistence (d418f01f, 46753e48, 40dd5b4f, 0142db3d).
 *
 * Obsidian's loadData and saveData offer no compare-and-swap, so a change that
 * lands between a save's read and its write is overwritten. The read happens
 * right before the write to keep that window short.
 *
 * A read that cannot be used refuses writes. Obsidian reports no rename, delete or
 * permission change of the file, so a loaded library retries on the checkpoint
 * interval and is written once a read succeeds, edited or not.
 */
export class DataFileWriter<Doc> {
	private chain: Promise<void> | null = null;
	/** A checkpoint waiting for its interval. */
	private timer: number | null = null;
	/** A check of the file waiting for the changes reported to it to settle. */
	private reportTimer: number | null = null;
	/** A save is queued and has not started, so later changes are written by it. */
	private saveQueued = false;
	private unloaded = false;
	/** Memory at unload: a callback that runs later must not reach the final save. */
	private memoryAtUnload: Doc | null = null;
	private publishing = false;
	private checkpointing = false;
	private lastSaveAt = Number.NEGATIVE_INFINITY;
	/** A write that failed, and the memory it was made from. It may have reached disk anyway. */
	private failedWrite: { local: Doc; written: Doc } | null = null;
	/** What PodNotes last loaded or wrote; null until a readable file was loaded. */
	private base: Doc | null;
	private refusal: Refusal | null;

	constructor(
		private readonly file: DataFileAccess<Doc>,
		private readonly clock: Clock,
		start: WriterStart<Doc>,
		private readonly events: WriterEvents,
	) {
		this.base = start.base;
		this.refusal = "refusal" in start ? start.refusal : null;
	}

	/**
	 * Save after any save already running; changes made until it starts share it.
	 * Inside `checkpoint`, or while a read is refused, wait for the checkpoint interval instead.
	 */
	request(): void {
		// Publishing sets stores, whose bindings ask for a save of what is already on disk.
		if (this.publishing) return;
		if (this.checkpointing || this.refusal) {
			this.scheduleCheckpoint();
			return;
		}
		this.cancelTimer();
		if (!this.saveQueued) void this.saveLogged();
	}

	/** Saves asked for while `update` runs are playback progress checkpoints. */
	checkpoint(update: () => void): void {
		this.checkpointing = true;
		try {
			update();
		} finally {
			this.checkpointing = false;
		}
	}

	/** Write what is not saved yet now. Resolves once queued work is done; never rejects. */
	flush(): Promise<void> {
		if (!this.blocked() && (this.timer !== null || this.pending())) {
			this.cancelTimer();
			if (!this.saveQueued) void this.saveLogged();
		}
		return (this.chain ?? Promise.resolve()).catch(() => undefined);
	}

	/** Save now. Rejects when the save fails or is refused; a failed write is the caller's to report. */
	save(): Promise<void> {
		this.cancelTimer();
		return this.enqueue(() => this.persist(false)).catch((error: unknown) => {
			throw toError(error, "PodNotes could not save its settings.");
		});
	}

	/**
	 * Obsidian calls this when data.json is newer than PodNotes' last write: Sync,
	 * another instance on the vault, or a hand edit. Edits not saved yet are merged
	 * on top, the same way a save merges.
	 */
	onExternalChange(): Promise<void> {
		return this.enqueue(() => this.applyExternalChange()).catch((error: unknown) => {
			console.error("PodNotes: failed to apply data.json changed elsewhere", error);
		});
	}

	/** data.json changed, maybe by PodNotes itself: check it once the changes stop. */
	report(): void {
		if (this.unloaded) return;
		if (this.reportTimer !== null) this.clock.clearTimeout(this.reportTimer);
		this.reportTimer = this.clock.setTimeout(() => {
			this.reportTimer = null;
			void this.onExternalChange();
		}, REPORT_SETTLE_MS);
	}

	/** The next instance reads the file itself; the flushed save still merges with disk. */
	unload(): Promise<void> {
		this.memoryAtUnload = this.file.local();
		this.unloaded = true;
		if (this.reportTimer !== null) this.clock.clearTimeout(this.reportTimer);
		this.reportTimer = null;
		return this.flush();
	}

	private saveLogged(checkpoint = false): Promise<void> {
		if (!checkpoint) this.saveQueued = true;
		return this.enqueue(async () => {
			if (checkpoint) {
				// A save that started while this one waited in line restarts the wait.
				if (this.clock.now() < this.lastSaveAt + CHECKPOINT_INTERVAL_MS) {
					this.scheduleCheckpoint();
					return;
				}
			} else {
				this.saveQueued = false;
			}
			await this.persist(true);
		}).catch((error: unknown) => {
			console.error("PodNotes: failed to save settings", error);
		});
	}

	private scheduleCheckpoint(): void {
		if (this.unloaded || this.blocked()) return;
		this.timer ??= this.clock.setTimeout(
			() => {
				this.timer = null;
				void this.saveLogged(true);
			},
			Math.max(0, this.lastSaveAt + CHECKPOINT_INTERVAL_MS - this.clock.now()),
		);
	}

	private blocked(): Refusal | null {
		const refusal = this.refusal;
		return refusal && (refusal.recovery === "stop" || this.base === null) ? refusal : null;
	}

	private pending(): boolean {
		return this.refusal !== null || this.failedWrite !== null || this.hasUnsavedEdits();
	}

	private refuse(refusal: Refusal): void {
		this.lastSaveAt = this.clock.now();
		const replaces = this.base !== null || refusal.recovery === "stop";
		if (replaces && this.refusal?.message !== refusal.message) {
			this.refusal = refusal;
			this.events.onRefusal(refusal);
		}
		if (this.blocked()) this.cancelTimer();
		else this.scheduleCheckpoint();
	}

	private lift(): void {
		if (!this.refusal) return;
		this.refusal = null;
		this.events.onRefusal(null);
	}

	private local(): Doc {
		return this.memoryAtUnload ?? this.file.local();
	}

	private hasUnsavedEdits(): boolean {
		return this.base !== null && !jsonValuesEqual(this.local(), this.base);
	}

	private publish(doc: Doc): void {
		// After unload, memory moves on only by what the writer itself merged in.
		if (this.memoryAtUnload) this.memoryAtUnload = structuredClone(doc);
		this.publishing = true;
		try {
			this.file.publish(doc);
		} finally {
			this.publishing = false;
		}
	}

	private cancelTimer(): void {
		if (this.timer !== null) this.clock.clearTimeout(this.timer);
		this.timer = null;
	}

	private enqueue(run: () => Promise<void>): Promise<void> {
		const chain: Promise<void> = (this.chain ?? Promise.resolve())
			.then(run, run)
			.finally(() => {
				if (this.chain === chain) this.chain = null;
			});
		this.chain = chain;
		return chain;
	}

	private async persist(warnOnFailure: boolean): Promise<void> {
		const blocked = this.blocked();
		if (blocked) throw new WriteRefusedError(blocked.message);
		if (!this.pending()) return;

		this.lastSaveAt = this.clock.now();
		const read = await this.file.read(this.base);
		if (read.kind === "refused") {
			this.refuse(read.refusal);
			throw new WriteRefusedError(read.refusal.message);
		}
		await this.writeMerged(read.kind === "file" ? read.doc : null, warnOnFailure);
	}

	private async writeMerged(disk: Doc | null, warnOnFailure: boolean): Promise<void> {
		this.lift();
		// Before the read settles a failed write the file holds, which does not end its streak.
		const reportFailure = warnOnFailure && !this.failedWrite;
		this.settleFailedWrite(disk);
		const base = this.base;
		// Captured after the read, so edits made while it was in flight are written too.
		const local = this.local();
		let toWrite = local;
		if (disk && base) {
			toWrite = mergeDataFile(base, local, disk);
		} else if (!disk && this.failedWrite) {
			// A failed write that left nothing on disk held the changes made elsewhere:
			// write them again, with the edits made here since.
			const { local: before, written } = this.failedWrite;
			toWrite = threeWayMergeSettings(before, local, written);
		}
		try {
			await this.file.write(toWrite);
		} catch (error) {
			if (error instanceof WriteRefusedError) throw error;
			if (reportFailure) this.events.onWriteFailed();
			this.failedWrite = { local, written: toWrite };
			this.scheduleCheckpoint();
			throw error;
		}
		this.failedWrite = null;
		this.settle(local, toWrite);
	}

	/**
	 * `written`, made from memory `local`, is on disk. Memory takes the changes made
	 * elsewhere only then; if the write fails, nothing here changed. Edits made since
	 * `local` stay on top.
	 */
	private settle(local: Doc, written: Doc): void {
		this.base = written;
		if (jsonValuesEqual(written, local)) return;
		const current = this.local();
		this.publish(
			jsonValuesEqual(current, local)
				? written
				: threeWayMergeSettings(local, current, written),
		);
	}

	private settleFailedWrite(disk: Doc | null): void {
		if (!this.failedWrite || !disk || !jsonValuesEqual(disk, this.failedWrite.written)) return;
		this.settle(this.failedWrite.local, this.failedWrite.written);
		this.failedWrite = null;
	}

	private async applyExternalChange(): Promise<void> {
		if (this.refusal?.recovery === "stop") return;
		const read = await this.file.read(this.base);
		if (this.unloaded) return;
		if (read.kind === "refused") {
			this.refuse(read.refusal);
			return;
		}
		const disk = read.kind === "file" ? read.doc : null;
		if (this.refusal && this.base !== null) {
			this.lastSaveAt = this.clock.now();
			await this.writeMerged(disk, true);
			return;
		}
		if (!disk) return;
		this.settleFailedWrite(disk);

		const base = this.base;
		if (base && jsonValuesEqual(disk, base)) return;

		const local = this.local();
		const merged = base ? mergeDataFile(base, local, disk) : structuredClone(disk);
		this.base = disk;
		this.lift();
		if (!jsonValuesEqual(merged, local)) this.publish(merged);
		if (jsonValuesEqual(merged, disk)) this.cancelTimer();
		else this.request();
	}
}
