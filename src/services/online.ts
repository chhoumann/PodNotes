import { readable, type Readable } from "svelte/store";

/**
 * Whether the device has a connection, as the window's navigator reports it, kept
 * current by its online and offline events. It listens only while something
 * subscribes, so it needs no disposal.
 */
export function onlineStatus(win: Window): Readable<boolean> {
	return readable(win.navigator.onLine, (set) => {
		const update = () => set(win.navigator.onLine);
		update();
		win.addEventListener("online", update);
		win.addEventListener("offline", update);
		return () => {
			win.removeEventListener("online", update);
			win.removeEventListener("offline", update);
		};
	});
}
