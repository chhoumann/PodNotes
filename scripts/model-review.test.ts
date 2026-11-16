import { expect, it } from "vitest";
import { PROVIDERS } from "src/services/transcription/registry";
import { curatedModels } from "./model-review.mjs";

it("reads the model IDs the providers offer", () => {
	const offered = Object.entries(PROVIDERS).flatMap(([provider, { models }]) =>
		models.map(({ id }) => ({ provider, id })),
	);
	const byProvider = (a: { provider: string }, b: { provider: string }) =>
		a.provider.localeCompare(b.provider);
	expect(curatedModels().sort(byProvider)).toEqual(offered.sort(byProvider));
});
