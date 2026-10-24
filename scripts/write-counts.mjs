import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jsLiteral } from "./js-literal.mjs";

/** @param {{write: (path: string, contents: string, ...rest: unknown[]) => Promise<unknown>}} adapter @param {string} dataPath */
export function installWriteRecorder(adapter, dataPath) {
	const original = adapter.write;
	const descriptor = Object.getOwnPropertyDescriptor(adapter, "write");
	const counts = {
		attempted: 0,
		completed: 0,
		failed: 0,
		inflight: 0,
		attemptedBytes: 0,
		completedBytes: 0,
		lastCompletedBytes: 0,
	};
	/**
	 * @param {string} path
	 * @param {string} contents
	 * @param {unknown[]} rest
	 * @this {typeof adapter}
	 */
	function wrapped(path, contents, ...rest) {
		if (path !== dataPath) return original.call(this, path, contents, ...rest);
		const bytes = new TextEncoder().encode(contents).byteLength;
		counts.attempted++;
		counts.inflight++;
		counts.attemptedBytes += bytes;
		try {
			return original.call(this, path, contents, ...rest).then(
				(result) => {
					counts.completed++;
					counts.inflight--;
					counts.completedBytes += bytes;
					counts.lastCompletedBytes = bytes;
					return result;
				},
				(error) => {
					counts.failed++;
					counts.inflight--;
					throw error;
				},
			);
		} catch (error) {
			counts.failed++;
			counts.inflight--;
			throw error;
		}
	}
	adapter.write = wrapped;
	return {
		report() {
			return {
				path: dataPath,
				...counts,
				intact: adapter.write === wrapped,
				complete: adapter.write === wrapped && counts.inflight === 0,
			};
		},
		stop() {
			if (adapter.write !== wrapped)
				throw new Error("Adapter writer changed during recording; counts are incomplete.");
			if (counts.inflight)
				throw new Error("Wait for pending writes before stopping the recorder.");
			const report = this.report();
			if (descriptor) Object.defineProperty(adapter, "write", descriptor);
			else Reflect.deleteProperty(adapter, "write");
			return report;
		},
	};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	try {
		const action = process.argv[2];
		if (process.argv.length !== 3 || !["start", "report", "stop"].includes(action))
			throw new Error("Usage: npm run count:writes -- start|report|stop");
		const code = `(() => {
			const key = "__podnotesWriteRecorder";
			const plugin = app.plugins.plugins.podnotes;
			if (${jsLiteral(action)} === "start") {
				if (!plugin) throw new Error("PodNotes is not loaded.");
				if (window[key]) throw new Error("A write recorder is already installed; stop it first.");
				const path = plugin.manifest.dir + "/data.json";
				window[key] = { plugin, control: (${installWriteRecorder.toString()})(app.vault.adapter, path) };
				return window[key].control.report();
			}
			const recorder = window[key];
			if (!recorder) throw new Error("No write recorder is installed.");
			const report = ${jsLiteral(action)} === "stop" ? recorder.control.stop() : recorder.control.report();
			report.pluginUnchanged = recorder.plugin === plugin;
			report.complete = report.complete && report.pluginUnchanged;
			if (${jsLiteral(action)} === "stop") delete window[key];
			return report;
		})()`;
		const result = spawnSync(
			process.execPath,
			[
				fileURLToPath(new URL("obsidian-e2e.mjs", import.meta.url)),
				"run",
				"eval",
				`code=${code}`,
			],
			{ encoding: "utf8" },
		);
		const output = result.stdout.match(/^=>\s*([\s\S]*)/m);
		if (result.error || result.status !== 0 || !output)
			throw new Error(result.error?.message ?? `${result.stdout}${result.stderr}`);
		const report = JSON.parse(output[1]);
		console.log(JSON.stringify(report, null, 2));
		if (!report.complete) process.exitCode = 1;
	} catch (error) {
		console.error(
			`Write-count recording failed: ${error instanceof Error ? error.message : error}`,
		);
		process.exitCode = 1;
	}
}
