import type { PlayerDocument } from "src/player/PlayerController";

/** An element's parent: a document body or a video stage. */
export class FakeParent {
	readonly children: FakeMedia[] = [];
	private migrated: Array<() => void> = [];

	constructor(public ownerDocument: unknown) {}

	append(media: FakeMedia): void {
		media.remove();
		this.children.push(media);
		media.parent = this;
	}

	prepend(media: FakeMedia): void {
		media.remove();
		this.children.unshift(media);
		media.parent = this;
	}

	/** Obsidian's DOM extension: runs `listener` when the element moves to another window. */
	onWindowMigrated(listener: () => void): () => void {
		this.migrated.push(listener);
		return () => {
			this.migrated = this.migrated.filter((l) => l !== listener);
		};
	}

	/** Moves this stage to another window's document. */
	migrateTo(ownerDocument: unknown): void {
		this.ownerDocument = ownerDocument;
		for (const listener of this.migrated) listener();
	}
}

/**
 * A media element without a browser. Tests set what the browser would (duration,
 * position) and dispatch its events. Setting `src` starts over like the HTML load
 * algorithm: position 0, paused, the default rate, and pending plays rejected.
 */
export class FakeMedia extends EventTarget {
	readonly tagName: string;
	className = "";
	hidden = false;
	parent: FakeParent | null = null;
	currentTime = 0;
	duration = Number.NaN;
	paused = true;
	defaultPlaybackRate = 1;
	playbackRate = 1;
	volume = 1;
	readonly attributes = new Map<string, string>();
	/** Unsettled play() calls, oldest first. */
	readonly plays: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
	private source = "";

	constructor(kind: string) {
		super();
		this.tagName = kind.toUpperCase();
	}

	get src(): string {
		return this.source;
	}

	set src(value: string) {
		this.source = value;
		this.reset();
	}

	play(): Promise<void> {
		this.paused = false;
		return new Promise((resolve, reject) => this.plays.push({ resolve, reject }));
	}

	pause(): void {
		if (this.paused) return;
		this.paused = true;
		this.rejectPlays();
	}

	load(): void {
		this.reset();
	}

	removeAttribute(name: string): void {
		if (name === "src") this.source = "";
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	remove(): void {
		const siblings = this.parent?.children;
		siblings?.splice(siblings.indexOf(this), 1);
		this.parent = null;
	}

	emit(type: string): void {
		this.dispatchEvent(new Event(type));
	}

	private reset(): void {
		this.currentTime = 0;
		this.duration = Number.NaN;
		this.paused = true;
		this.playbackRate = this.defaultPlaybackRate;
		this.rejectPlays();
	}

	private rejectPlays(): void {
		for (const play of this.plays.splice(0)) {
			play.reject(new DOMException("The play() request was interrupted.", "AbortError"));
		}
	}
}

export class FakeDocument {
	readonly body = new FakeParent(this);
	readonly created: FakeMedia[] = [];

	createElement(kind: string): FakeMedia {
		const media = new FakeMedia(kind);
		this.created.push(media);
		return media;
	}

	/** The element created last, the one the player drives. */
	get media(): FakeMedia {
		return this.created[this.created.length - 1];
	}

	asPlayerDocument(): PlayerDocument {
		return this as unknown as PlayerDocument;
	}
}
