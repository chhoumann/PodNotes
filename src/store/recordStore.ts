import { writable, type Writable } from "svelte/store";
import { ownRecord } from "src/utility/ownRecord";

function own<T>(value: Record<string, T>): Record<string, T> {
	return Object.getPrototypeOf(value) === null ? value : ownRecord(value);
}

export function recordStore<T>(): Writable<Record<string, T>> {
	const store = writable(ownRecord<T>());
	return {
		subscribe: store.subscribe,
		set: (value) => store.set(own(value)),
		update: (updater) => store.update((value) => own(updater(value))),
	};
}
