import type { Plugin } from "vite";

const HYDRATION_MODULE = "/svelte/src/internal/client/dom/hydration.js";
const DECLARATION = "export let hydrating = false;";
const SETTER = /export function set_hydrating\(value\) \{\s*hydrating = value;\s*\}/;

/**
 * PodNotes mounts its components and never hydrates server-rendered markup, so
 * Svelte's `hydrating` flag stays false. Svelte also restores the flag from
 * values it read earlier, which the minifier cannot prove are false, so every
 * hydration branch would ship. Pinning the flag lets the minifier remove them.
 */
export function svelteWithoutHydration(): Plugin {
	let pinned = false;
	return {
		name: "podnotes-svelte-without-hydration",
		transform(code, id) {
			if (!id.endsWith(HYDRATION_MODULE)) return;
			if (!code.includes(DECLARATION) || !SETTER.test(code)) {
				throw new Error(`Svelte's hydration flag changed shape in ${id}.`);
			}
			pinned = true;
			return code
				.replace(DECLARATION, "export const hydrating = false;")
				.replace(SETTER, "export function set_hydrating(value) {}");
		},
		buildEnd(error) {
			if (!error && !pinned) throw new Error(`Svelte no longer has ${HYDRATION_MODULE}.`);
		},
	};
}
