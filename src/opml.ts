import { TFile, Notice } from "obsidian";
import FeedParser from "./parser/feedParser";
import { savedFeeds } from "./store";
import { PodcastFeed } from "./types/PodcastFeed";

async function importOPML(targetFile: TFile) {
	const fileContent = await app.vault.cachedRead(targetFile);
	const dp = new DOMParser();
	const dom = dp.parseFromString(fileContent, "application/xml");

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

	const podcasts: PodcastFeed[] = await Promise.all(
		incompletePodcastsToAdd.map(async (feed) => {
			return new FeedParser().getFeed(feed.url);
		})
	);

	savedFeeds.update((feeds) => {
		for (const pod of podcasts) {
			if (feeds[pod.title]) continue;
			feeds[pod.title] = structuredClone(pod);
		}

		return feeds;
	});

	new Notice(
		`${targetFile.name} ingested. Saved ${podcasts.length} / ${incompletePodcastsToAdd.length} podcasts.`
	);

	if (podcasts.length !== incompletePodcastsToAdd.length) {
		const missingPodcasts = incompletePodcastsToAdd.filter(
			(pod) => !podcasts.find((v) => v.url === pod.url)
		);

		for (const missingPod of missingPodcasts) {
			new Notice(`Failed to save ${missingPod.title}...`, 60000);
		}
	}
}

async function exportOPML(
	feeds: PodcastFeed[],
	filePath = "PodNotes_Export.opml"
) {
	const header = `<?xml version="1.0" encoding="utf=8" standalone="no"?>`;
	const opml = (child: string) => `<opml version="1.0">${child}</opml>`;
	const head = (child: string) => `<head>${child}</head>`;
	const title = `<title>PodNotes Feeds</title>`;
	const body = (child: string) => `<body>${child}</body>`;
	const feedOutline = (feed: PodcastFeed) =>
		`<outline text="${feed.title}" type="rss" xmlUrl="${feed.url}" />`;
	const feedsOutline = (_feeds: PodcastFeed[]) =>
		`<outline text="feeds">${feeds.map(feedOutline).join("")}</outline>`;

	const doc = header + opml(`${head(title)}\n${body(feedsOutline(feeds))}`);

	try {
		await app.vault.create(filePath, doc);

		new Notice(
			`Exported ${feeds.length} podcast feeds to file "${filePath}".`
		);
	} catch (error) {
		new Notice(
			"Unable to create podcast export file. See console for more details."
		);
		console.error(error);
	}
}

export { importOPML, exportOPML };
