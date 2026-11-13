import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

it("main.js names gpt-transcribe and no model OpenAI shuts down on 2027-02-26", async () => {
	vi.stubEnv("NODE_ENV", "production");
	try {
		const result = await build({
			configFile: path.join(root, "vite.config.ts"),
			configLoader: "bundle",
			mode: "production",
			logLevel: "silent",
			build: { write: false },
		});
		if (!Array.isArray(result)) throw new Error("Expected library build outputs");
		const [chunk] = result.flatMap(({ output }) => output);
		if (chunk?.type !== "chunk") throw new Error("Expected a JavaScript chunk");

		// The retired ones are whisper-1 and the gpt-4o transcription models.
		const named = chunk.code.match(/whisper-1|gpt-4o[\w-]*|gpt-transcribe/g) ?? [];
		expect([...new Set(named)]).toEqual(["gpt-transcribe"]);
	} finally {
		vi.unstubAllEnvs();
	}
}, 120_000);
