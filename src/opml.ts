import { type App, Notice } from "obsidian";
import FeedParser from "./parser/feedParser";
import { savedFeeds } from "./store";
import type { PodcastFeed } from "./types/PodcastFeed";
import { get } from "svelte/store";

/**
 * Read an attribute by name regardless of its casing. OPML in the wild is
 * inconsistent about the `xmlUrl` attribute (xmlurl, XmlUrl, xmlURL, ...), so a
 * fixed-case `getAttribute("xmlUrl")` silently drops otherwise-valid feeds.
 * Returns the trimmed value, or null when absent/empty.
 */
function getAttributeCaseInsensitive(
	node: Element,
	name: string,
): string | null {
	const target = name.toLowerCase();
	for (let i = 0; i < node.attributes.length; i++) {
		const attr = node.attributes.item(i);
		if (attr && attr.name.toLowerCase() === target) {
			const value = attr.value?.trim();
			return value ? value : null;
		}
	}
	return null;
}

function TimerNotice(heading: string, initialMessage: string) {
	let currentMessage = initialMessage;
	const startTime = Date.now();
	let stopTime: number | undefined;
	let intervalId: number | undefined;
	const notice = new Notice(initialMessage, 0);

	function formatMsg(message: string): string {
		return `${heading} (${getTime()}):\n\n${message}`;
	}

	function update(message: string) {
		currentMessage = message;
		notice.setMessage(formatMsg(currentMessage));
	}

	function getTime(): string {
		return formatTime(stopTime ? stopTime - startTime : Date.now() - startTime);
	}

	function clearTimer() {
		if (intervalId !== undefined) {
			window.clearInterval(intervalId);
			intervalId = undefined;
		}
	}

	intervalId = window.setInterval(() => {
		notice.setMessage(formatMsg(currentMessage));
	}, 1000);

	return {
		update,
		hide: () => {
			clearTimer();
			notice.hide();
		},
		stop: () => {
			stopTime = Date.now();
			clearTimer();
		},
	};
}

function formatTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	return `${hours.toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

async function importOPML(opml: string): Promise<void> {
	try {
		const dp = new DOMParser();
		const dom = dp.parseFromString(opml, "application/xml");

		// DOMParser reports a malformed document by injecting a <parsererror>
		// element rather than throwing. The previous root-nodeName check only
		// worked in jsdom; Chromium (Obsidian's runtime) nests parsererror under
		// the document body, so querySelector is the engine-agnostic detection.
		if (dom.querySelector("parsererror")) {
			throw new Error("Invalid XML format");
		}

		// Select on the always-lowercase tag and the camelCase-safe `text` attr;
		// the xmlUrl attribute is read case-insensitively below so feeds written
		// with a lowercase/variant casing (e.g. `xmlurl`) aren't silently dropped.
		const podcastEntryNodes = dom.querySelectorAll("outline[text]");
		const incompletePodcastsToAdd: Pick<PodcastFeed, "title" | "url">[] = [];
		for (let i = 0; i < podcastEntryNodes.length; i++) {
			const node = podcastEntryNodes.item(i);

			const text = node.getAttribute("text");
			const xmlUrl = getAttributeCaseInsensitive(node, "xmlUrl");
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

		const existingSavedFeeds = get(savedFeeds);
		const newPodcastsToAdd = incompletePodcastsToAdd.filter(
			(pod) =>
				!Object.values(existingSavedFeeds).some(
					(savedPod) => savedPod.url === pod.url,
				),
		);

		const notice = TimerNotice("Importing podcasts", "Preparing to import...");
		let completedImports = 0;

		const updateProgress = () => {
			const progress = (
				(completedImports / newPodcastsToAdd.length) *
				100
			).toFixed(1);
			notice.update(
				`Importing... ${completedImports}/${newPodcastsToAdd.length} podcasts completed (${progress}%)`,
			);
		};

		updateProgress();

		const podcasts: (PodcastFeed | null)[] = await Promise.all(
			newPodcastsToAdd.map(async (feed) => {
				try {
					const result = await new FeedParser().getFeed(feed.url);
					completedImports++;
					updateProgress();
					return result;
				} catch (error) {
					console.error(`Failed to fetch feed for ${feed.title}: ${error}`);
					completedImports++;
					updateProgress();
					return null;
				}
			}),
		);

		notice.stop();

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

		const skippedCount =
			incompletePodcastsToAdd.length - newPodcastsToAdd.length;
		notice.update(
			`OPML import complete. Saved ${validPodcasts.length} new podcasts. Skipped ${skippedCount} existing podcasts.`,
		);

		if (validPodcasts.length !== newPodcastsToAdd.length) {
			const failedImports = newPodcastsToAdd.length - validPodcasts.length;
			console.error(`Failed to import ${failedImports} podcasts.`);
			new Notice(
				`Failed to import ${failedImports} podcasts. Check console for details.`,
				10000,
			);
		}

		window.setTimeout(() => notice.hide(), 5000);
	} catch (error) {
		console.error("Error importing OPML:", error);
		new Notice(
			`Error importing OPML: ${error instanceof Error ? error.message : "Unknown error"}`,
			10000,
		);
	}
}

async function exportOPML(
	app: App,
	feeds: PodcastFeed[],
	filePath = "PodNotes_Export.opml",
) {
	const header = `<?xml version="1.0" encoding="utf-8" standalone="no"?>`;
	const opml = (child: string) => `<opml version="1.0">${child}</opml>`;
	const head = (child: string) => `<head>${child}</head>`;
	const title = "<title>PodNotes Feeds</title>";
	const body = (child: string) => `<body>${child}</body>`;
	// Escape every interpolated attribute value so titles/URLs containing &, <,
	// >, or " produce well-formed XML that round-trips back through importOPML.
	// `&` must run first so the entities written by the later replaces are not
	// themselves re-escaped.
	const escAttr = (s: string) =>
		s
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	const feedOutline = (feed: PodcastFeed) =>
		`<outline text="${escAttr(feed.title)}" type="rss" xmlUrl="${escAttr(feed.url)}" />`;
	const feedsOutline = (_feeds: PodcastFeed[]) =>
		`<outline text="feeds">${feeds.map(feedOutline).join("")}</outline>`;

	const doc = header + opml(`${head(title)}\n${body(feedsOutline(feeds))}`);

	try {
		await app.vault.create(filePath, doc);

		new Notice(`Exported ${feeds.length} podcast feeds to file "${filePath}".`);
	} catch (error) {
		if (error instanceof Error) {
			if (error.message.includes("Folder does not exist")) {
				new Notice("Unable to create export file: Folder does not exist.");
			} else {
				new Notice(`Unable to create podcast export file:\n\n${error.message}`);
			}
		} else {
			new Notice("An unexpected error occurred during export.");
		}

		console.error(error);
	}
}

export { importOPML, exportOPML };
