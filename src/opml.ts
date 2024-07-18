import { type App, Notice } from "obsidian";
import FeedParser from "./parser/feedParser";
import { savedFeeds } from "./store";
import type { PodcastFeed } from "./types/PodcastFeed";

async function importOPML(opml: string) {
	try {
		const dp = new DOMParser();
		const dom = dp.parseFromString(opml, "application/xml");

		if (dom.documentElement.nodeName === "parsererror") {
			throw new Error("Invalid XML format");
		}

		const podcastEntryNodes = dom.querySelectorAll("outline[text][xmlUrl]");
		const incompletePodcastsToAdd: Pick<PodcastFeed, "title" | "url">[] = [];
		for (let i = 0; i < podcastEntryNodes.length; i++) {
			const node = podcastEntryNodes.item(i);

			const text = node.getAttribute("text");
			const xmlUrl = node.getAttribute("xmlUrl");
			if (!text || !xmlUrl) {
				continue;
			}

			incompletePodcastsToAdd.push({
				title: text,
				url: xmlUrl,
			});
		}

		if (incompletePodcastsToAdd.length === 0) {
			throw new Error("No valid podcast entries found in OPML");
		}

		const podcasts: (PodcastFeed | null)[] = await Promise.all(
			incompletePodcastsToAdd.map(async (feed) => {
				try {
					return await new FeedParser().getFeed(feed.url);
				} catch (error) {
					console.error(`Failed to fetch feed for ${feed.title}: ${error}`);
					return null;
				}
			}),
		);

		const validPodcasts = podcasts.filter(
			(pod): pod is PodcastFeed => pod !== null,
		);

		savedFeeds.update((feeds) => {
			for (const pod of validPodcasts) {
				if (feeds[pod.title]) continue;
				feeds[pod.title] = structuredClone(pod);
			}

			return feeds;
		});

		new Notice(
			`OPML ingested. Saved ${validPodcasts.length} / ${incompletePodcastsToAdd.length} podcasts.`,
		);

		if (validPodcasts.length !== incompletePodcastsToAdd.length) {
			const missingPodcasts = incompletePodcastsToAdd.filter(
				(pod) => !validPodcasts.find((v) => v.url === pod.url),
			);

			for (const missingPod of missingPodcasts) {
				new Notice(`Failed to save ${missingPod.title}...`, 60000);
			}
		}
	} catch (error) {
		console.error("Error importing OPML:", error);
	}
}

async function exportOPML(
	app: App,
	feeds: PodcastFeed[],
	filePath = "PodNotes_Export.opml",
) {
	const header = `<?xml version="1.0" encoding="utf=8" standalone="no"?>`;
	const opml = (child: string) => `<opml version="1.0">${child}</opml>`;
	const head = (child: string) => `<head>${child}</head>`;
	const title = "<title>PodNotes Feeds</title>";
	const body = (child: string) => `<body>${child}</body>`;
	const feedOutline = (feed: PodcastFeed) =>
		`<outline text="${feed.title}" type="rss" xmlUrl="${feed.url}" />`;
	const feedsOutline = (_feeds: PodcastFeed[]) =>
		`<outline text="feeds">${feeds.map(feedOutline).join("")}</outline>`;

	const doc = header + opml(`${head(title)}\n${body(feedsOutline(feeds))}`);

	try {
		await app.vault.create(filePath, doc);

		new Notice(`Exported ${feeds.length} podcast feeds to file "${filePath}".`);
	} catch (error) {
		new Notice(`Unable to create podcast export file:\n\n${error}`);

		console.error(error);
	}
}

export { importOPML, exportOPML };
