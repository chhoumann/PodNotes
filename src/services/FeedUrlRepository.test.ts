import { describe, expect, it, vi } from "vitest";
import type { SecretStorage } from "obsidian";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { FeedUrlRepository, isFeedUrlSecretId } from "./FeedUrlRepository";

function storage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		api: {
			getSecret: vi.fn((id: string) => values.get(id) ?? null),
			setSecret: vi.fn((id: string, value: string) => {
				values.set(id, value);
			}),
			listSecrets: vi.fn(() => [...values.keys()]),
		} as unknown as SecretStorage,
	};
}

function feed(overrides: Partial<PodcastFeed> = {}): PodcastFeed {
	return { title: "Show", url: "https://example.com/rss", artworkUrl: "", ...overrides };
}

describe("FeedUrlRepository", () => {
	it("stores a URL under the PodNotes feed-url ID and verifies the readback", () => {
		const { api, values } = storage();
		const id = new FeedUrlRepository(api).store("  https://p.example/rss?auth=tok  ");
		expect(id).toBe("podnotes-feed-url");
		expect(values.get(id)).toBe("https://p.example/rss?auth=tok");
	});

	it("reuses an identical value and suffixes past a conflicting one", () => {
		const { api } = storage({ "podnotes-feed-url": "https://a.example/rss?auth=1" });
		const repository = new FeedUrlRepository(api);
		expect(repository.store("https://a.example/rss?auth=1")).toBe("podnotes-feed-url");
		expect(repository.store("https://b.example/rss?auth=2")).toBe("podnotes-feed-url-2");
	});

	it("reuses a cleared slot after deletion", () => {
		const { api } = storage({ "podnotes-feed-url": "" });
		expect(new FeedUrlRepository(api).store("https://c.example/rss?auth=3")).toBe(
			"podnotes-feed-url",
		);
	});

	it("throws when SecretStorage does not retain the value", () => {
		const { api } = storage();
		(api.setSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {});
		expect(() => new FeedUrlRepository(api).store("https://x.example/rss?auth=t")).toThrow(
			/did not retain/,
		);
	});

	it("resolves only PodNotes-owned feed-url IDs and fails closed", () => {
		const { api } = storage({
			"podnotes-feed-url": "https://p.example/rss?auth=tok",
			"podnotes-openai-api-key": "sk-not-a-feed",
		});
		const repository = new FeedUrlRepository(api);
		expect(repository.resolve("podnotes-feed-url")).toBe("https://p.example/rss?auth=tok");
		expect(repository.resolve("podnotes-openai-api-key")).toBeNull();
		expect(repository.resolve("podnotes-feed-url-9")).toBeNull();
		expect(repository.resolve("")).toBeNull();
	});

	it("returns null when the storage read throws", () => {
		const { api } = storage();
		(api.getSecret as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("locked");
		});
		expect(new FeedUrlRepository(api).resolve("podnotes-feed-url")).toBeNull();
	});

	it("deletes by clearing and refuses foreign IDs", () => {
		const { api, values } = storage({
			"podnotes-feed-url": "https://p.example/rss?auth=tok",
			"podnotes-openai-api-key": "sk-keep",
		});
		const repository = new FeedUrlRepository(api);
		repository.delete("podnotes-feed-url");
		expect(values.get("podnotes-feed-url")).toBe("");
		repository.delete("podnotes-openai-api-key");
		expect(values.get("podnotes-openai-api-key")).toBe("sk-keep");
	});

	it("sweeps unreferenced feed-url secrets and nothing else", () => {
		const { api, values } = storage({
			"podnotes-feed-url": "https://kept.example/rss?auth=1",
			"podnotes-feed-url-2": "https://orphan.example/rss?auth=2",
			"podnotes-openai-api-key": "sk-keep",
		});
		new FeedUrlRepository(api).sweepOrphans({
			Kept: feed({ urlSecretId: "podnotes-feed-url" }),
			Public: feed(),
		});
		expect(values.get("podnotes-feed-url")).toBe("https://kept.example/rss?auth=1");
		expect(values.get("podnotes-feed-url-2")).toBe("");
		expect(values.get("podnotes-openai-api-key")).toBe("sk-keep");
	});
});

describe("isFeedUrlSecretId", () => {
	it("accepts only the PodNotes feed-url grammar", () => {
		expect(isFeedUrlSecretId("podnotes-feed-url")).toBe(true);
		expect(isFeedUrlSecretId("podnotes-feed-url-2")).toBe(true);
		expect(isFeedUrlSecretId("podnotes-feed-url-0")).toBe(false);
		expect(isFeedUrlSecretId("podnotes-openai-api-key")).toBe(false);
		expect(isFeedUrlSecretId("feed-url")).toBe(false);
	});
});
