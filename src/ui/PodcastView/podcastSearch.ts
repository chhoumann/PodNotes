import { debounce } from "obsidian";
import { writable, type Readable, type Subscriber, type Unsubscriber } from "svelte/store";
import {
	lookupiTunesPodcast,
	parseApplePodcastsId,
	queryiTunesPodcasts,
	type DirectoryShow,
} from "src/iTunesAPIConsumer";
import type { FeedRepository } from "src/services/FeedRepository";
import checkStringIsUrl from "src/utility/checkStringIsUrl";

export interface PodcastResult extends DirectoryShow {
	/** The source a pasted link resolved through. */
	readonly via?: "RSS feed" | "podcasts.apple.com";
}

/** Never an error's message, which can carry a private feed's address. */
export type SearchFailure = "offline" | "no-feed" | "feed" | "search";

export type SearchState = { readonly query: string } & (
	| { readonly status: "idle" }
	| { readonly status: "searching" }
	| { readonly status: "results"; readonly results: readonly PodcastResult[] }
	| { readonly status: "failed"; readonly failure: SearchFailure }
);

/**
 * The Add podcast query and what it found. One lives as long as the view, so the
 * text typed on First run is still there when Add podcast opens. A name searches
 * after 300 ms of quiet and a link resolves at once. Only the newest input may
 * publish, so a slow answer to an earlier one never replaces it.
 */
export class PodcastSearch implements Readable<SearchState> {
	private readonly state = writable<SearchState>({ query: "", status: "idle" });
	private latest = 0;
	private readonly searchSoon = debounce(
		(term: string, run: number) =>
			void this.run(run, "search", () => queryiTunesPodcasts(term)),
		300,
		true,
	);

	constructor(private readonly feeds: Pick<FeedRepository, "channelAt">) {}

	subscribe(run: Subscriber<SearchState>): Unsubscriber {
		return this.state.subscribe(run);
	}

	set(query: string): void {
		const run = ++this.latest;
		this.searchSoon.cancel();
		const text = query.trim();
		if (!text) return this.state.set({ query, status: "idle" });

		this.state.set({ query, status: "searching" });
		const appleId = parseApplePodcastsId(text);
		const url = checkStringIsUrl(text);
		if (appleId) {
			void this.run(run, "search", async () => {
				const show = await lookupiTunesPodcast(appleId);
				return show ? [{ ...show, via: "podcasts.apple.com" }] : "no-feed";
			});
		} else if (url?.protocol === "http:" || url?.protocol === "https:") {
			void this.run(run, "feed", async () => [
				{ feed: await this.feeds.channelAt({ url: url.href }), via: "RSS feed" },
			]);
		} else {
			this.searchSoon(text, run);
		}
	}

	private async run(
		run: number,
		failure: SearchFailure,
		find: () => Promise<PodcastResult[] | "no-feed">,
	): Promise<void> {
		let found: PodcastResult[] | SearchFailure;
		try {
			found = await find();
		} catch {
			found = navigator.onLine ? failure : "offline";
		}
		if (run !== this.latest) return;
		this.state.update(({ query }) =>
			typeof found === "string"
				? { query, status: "failed", failure: found }
				: { query, status: "results", results: found },
		);
	}
}
