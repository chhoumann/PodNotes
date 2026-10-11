import type PodNotes from "src/main";
import type { Clock } from "src/persistence/writer";

/** A clock whose time and timers move only when a test moves them. */
export function manualClock(): Clock & {
	delays: number[];
	pending(): number;
	runAll(): void;
	advance(ms: number): void;
} {
	const timers = new Map<number, () => void>();
	const delays: number[] = [];
	let next = 1;
	let now = 0;
	return {
		delays,
		setTimeout(callback, ms) {
			delays.push(ms);
			timers.set(next, callback);
			return next++;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
		now: () => now,
		advance(ms) {
			now += ms;
		},
		pending: () => timers.size,
		runAll() {
			const callbacks = [...timers.values()];
			timers.clear();
			for (const callback of callbacks) callback();
		},
	};
}

/** data.json as Obsidian's saveData writes this data. */
export function dataFileText(data: unknown): string {
	return JSON.stringify(data, undefined, 2);
}

/** Gives a plugin built with Object.create the writer its onload would create. */
export function attachDataFileWriter(plugin: PodNotes, clock: Clock = manualClock()): void {
	const internals = plugin as unknown as { createWriter(clock: Clock): unknown };
	Object.assign(plugin, { writer: internals.createWriter(clock) });
}
