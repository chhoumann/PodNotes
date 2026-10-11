import { toError } from "src/utility/toError";
import { jsonValuesEqual, threeWayMergeSettings } from "./merge";

/** Timers of the main window. A popout's timers stop when the popout closes. */
export interface Clock {
	setTimeout(callback: () => void, ms: number): number;
	clearTimeout(id: number): void;
	now(): number;
}

/** How the writer reaches data.json and the in-memory state, as plain JSON documents. */
export interface DataFileAccess<Doc> {
	/**
	 * The file now, or null when it does not exist or holds only the start of a write
	 * that failed. Rejects when it cannot be read. Entries that had to be dropped to
	 * read it are reported as `base` has them.
	 */
	read(base: Doc | null): Promise<Doc | null>;
	write(doc: Doc): Promise<void>;
	/** The in-memory state as the document it would write. */
	local(): Doc;
	/** Replace the in-memory state with a document that came from disk. */
	publish(doc: Doc): void;
}

const SAVE_DELAY_MS = 1000;
// Each save rewrites the whole file, and progress changes every few seconds during
// playback, so a requested save starts at least this long after the last one.
const MIN_SAVE_INTERVAL_MS = 10_000;

/**
 * Writes data.json without clobbering changes another device synced in. Every
 * save and every external change runs on one promise chain and merges base
 * (what was last loaded or written), memory and disk three ways. Ported from
 * QuickAdd's settings persistence (d418f01f, 46753e48, 40dd5b4f, 0142db3d).
 *
 * Obsidian's loadData and saveData offer no compare-and-swap, so a change that
 * lands between a save's read and its write is overwritten. The read happens
 * right before the write to keep that window short.
 */
export class DataFileWriter<Doc> {
	private chain: Promise<void> | null = null;
	private timer: number | null = null;
	private unloaded = false;
	private closed = false;
	private publishing = false;
	private lastSaveAt = Number.NEGATIVE_INFINITY;
	/** A write that failed, and the memory it was made from. It may have reached disk anyway. */
	private failedWrite: { local: Doc; written: Doc } | null = null;

	constructor(
		private readonly file: DataFileAccess<Doc>,
		private readonly clock: Clock,
		/** What PodNotes last loaded or wrote; null until a readable file was loaded. */
		private base: Doc | null,
	) {}

	/** Whether a readable data.json has been loaded or written. */
	get hasBase(): boolean {
		return this.base !== null;
	}

	/** Save a moment after the latest burst of changes. */
	request(): void {
		// Publishing sets stores, whose bindings ask for a save of what is already on disk.
		if (this.publishing || this.closed) return;
		this.timer ??= this.clock.setTimeout(
			() => {
				this.timer = null;
				void this.saveLogged(true);
			},
			Math.max(SAVE_DELAY_MS, this.lastSaveAt + MIN_SAVE_INTERVAL_MS - this.clock.now()),
		);
	}

	/** Write what is not saved yet now. Resolves once queued work is done; never rejects. */
	flush(): Promise<void> {
		if (!this.closed && (this.timer !== null || this.failedWrite || this.hasUnsavedEdits())) {
			this.cancelTimer();
			void this.saveLogged();
		}
		return (this.chain ?? Promise.resolve()).catch(() => undefined);
	}

	/** Save now. Rejects when the save fails. */
	save(): Promise<void> {
		if (this.closed)
			return Promise.reject(new Error("PodNotes stopped saving while Obsidian closes."));
		this.cancelTimer();
		return this.enqueue(() => this.persist()).catch((error: unknown) => {
			throw toError(error, "PodNotes could not save its settings.");
		});
	}

	/**
	 * Obsidian calls this when data.json is newer than PodNotes' last write: Sync,
	 * another instance on the vault, or a hand edit. Edits not saved yet are merged
	 * on top, the same way a save merges.
	 */
	onExternalChange(): Promise<void> {
		if (this.closed) return Promise.resolve();
		return this.enqueue(() => this.applyExternalChange()).catch((error: unknown) => {
			console.error("PodNotes: failed to apply data.json changed elsewhere", error);
		});
	}

	/**
	 * Obsidian closes the window once its quit tasks settle. Write what is pending,
	 * then start nothing more. Null when there is nothing to wait for.
	 */
	close(): Promise<void> | null {
		const done = this.flush();
		this.closed = true;
		return this.chain ? done : null;
	}

	/** The next instance reads the file itself; the flushed save still merges with disk. */
	unload(): Promise<void> {
		this.unloaded = true;
		return this.flush();
	}

	private saveLogged(requested = false): Promise<void> {
		return this.enqueue(async () => {
			// A save that started while this one waited in line restarts the wait.
			if (requested && this.clock.now() < this.lastSaveAt + MIN_SAVE_INTERVAL_MS) {
				this.request();
				return;
			}
			await this.persist();
		}).catch((error: unknown) => {
			console.error("PodNotes: failed to save settings", error);
		});
	}

	private hasUnsavedEdits(): boolean {
		return this.base !== null && !jsonValuesEqual(this.file.local(), this.base);
	}

	private publish(doc: Doc): void {
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

	private async persist(): Promise<void> {
		// After a failed write the file is unknown, so memory equal to base proves nothing.
		if (this.base && !this.failedWrite && !this.hasUnsavedEdits()) return;

		this.lastSaveAt = this.clock.now();
		// With the file cut short by a failed write, what that write was writing stands in.
		const disk = (await this.file.read(this.base)) ?? this.failedWrite?.written ?? null;
		if (this.failedWrite && disk && jsonValuesEqual(disk, this.failedWrite.written)) {
			this.settle(this.failedWrite.local, this.failedWrite.written);
		}
		const base = this.base;
		// Captured after the read, so edits made while it was in flight are written too.
		const local = this.file.local();
		// With nothing loaded or nothing on disk there is nothing to merge with.
		const toWrite = base && disk ? threeWayMergeSettings(base, local, disk) : local;
		try {
			await this.file.write(toWrite);
		} catch (error) {
			this.failedWrite = { local, written: toWrite };
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
		const current = this.file.local();
		this.publish(
			jsonValuesEqual(current, local)
				? written
				: threeWayMergeSettings(local, current, written),
		);
	}

	private async applyExternalChange(): Promise<void> {
		let disk: Doc | null;
		try {
			disk = await this.file.read(this.base);
		} catch (error) {
			// A sync client can leave a half-written file; its complete write calls again.
			console.warn("PodNotes could not read its changed data.json", error);
			return;
		}
		// A missing file is not a request to reset everything.
		if (!disk || this.unloaded) return;

		const base = this.base;
		if (base && jsonValuesEqual(disk, base)) return;

		const local = this.file.local();
		const merged = base ? threeWayMergeSettings(base, local, disk) : structuredClone(disk);
		this.base = disk;
		if (!jsonValuesEqual(merged, local)) this.publish(merged);
		if (jsonValuesEqual(merged, disk)) this.cancelTimer();
		else this.request();
	}
}
