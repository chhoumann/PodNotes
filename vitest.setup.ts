import { afterAll, beforeEach } from "vitest";

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
				// The formatter reads `window` once per printed object, so find the
				// reader from a one-frame stack and build the full error only for ours.
				const stackTraceLimit = Error.stackTraceLimit;
				Error.stackTraceLimit = 1;
				const reader: { stack?: string } = {};
				Error.captureStackTrace(reader, read);
				Error.stackTraceLimit = stackTraceLimit;
				if (/[\\/]node_modules[\\/]@?vitest[\\/]/.test(reader.stack ?? "")) {
					return undefined;
				}
				firstRead = new Error(
					`This test reads \`${name}\`; add \`// @vitest-environment jsdom\` to its file.`,
				);
				Error.captureStackTrace(firstRead, read);
				return undefined;
			},
		});
	}
	const failOnRead = () => {
		const read = firstRead;
		firstRead = undefined;
		if (read) throw read;
	};
	// Finish hooks run after the test's own afterEach and onTestFinished
	// callbacks, so a read there fails the test that made it.
	beforeEach(({ onTestFinished }) => onTestFinished(failOnRead));
	afterAll(failOnRead);
}
