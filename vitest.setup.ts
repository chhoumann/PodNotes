import { afterAll, afterEach } from "vitest";

if (typeof window !== "undefined") {
	await import("./vitest.setup.dom");
} else {
	// Svelte's store runtime reads `document` once when it loads. Load it before
	// the trap below, so that read never counts.
	await import("svelte/store");

	// Code that guards its DOM path with `typeof window` or `typeof document`
	// would skip that path under Node, so a test could pass without running it.
	// Fail it instead. Reads by Vitest itself, such as its object formatter
	// probing `window`, do not count.
	let firstRead: Error | undefined;
	for (const name of ["window", "document"]) {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			get: function read() {
				if (firstRead) return undefined;
				const error = new Error(
					`This test reads \`${name}\`; add \`// @vitest-environment jsdom\` to its file.`,
				);
				Error.captureStackTrace(error, read);
				const reader = error.stack?.split("\n")[1] ?? "";
				if (!/[\\/]node_modules[\\/]@?vitest[\\/]/.test(reader)) firstRead = error;
				return undefined;
			},
		});
	}
	const failOnRead = () => {
		const read = firstRead;
		firstRead = undefined;
		if (read) throw read;
	};
	afterEach(failOnRead);
	afterAll(failOnRead);
}
