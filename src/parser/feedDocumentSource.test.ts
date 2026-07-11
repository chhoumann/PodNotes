import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTextWithTimeout } from "src/utility/networkRequest";
import { legacyObsidianFeedDocumentSource } from "./feedDocumentSource";

vi.mock("src/utility/networkRequest", () => ({
	fetchTextWithTimeout: vi.fn(),
}));

const requestMock = vi.mocked(fetchTextWithTimeout);

describe("legacyObsidianFeedDocumentSource", () => {
	beforeEach(() => requestMock.mockReset());

	it("loads feed text through the bounded shared request boundary", async () => {
		requestMock.mockResolvedValue("<rss />");

		await expect(
			legacyObsidianFeedDocumentSource.load("https://feeds.example.com/show.xml"),
		).resolves.toBe("<rss />");
		expect(requestMock).toHaveBeenCalledWith("https://feeds.example.com/show.xml", {
			timeoutMs: 30_000,
			maxResponseBytes: 16 * 1024 * 1024,
			acceptedStatuses: [200],
		});
	});
});
