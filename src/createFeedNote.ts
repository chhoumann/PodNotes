import { Notice, TFile } from "obsidian";
import { FeedFilePathTemplateEngine, FeedNoteTemplateEngine } from "./TemplateEngine";
import type { PodcastFeed } from "./types/PodcastFeed";
import { get } from "svelte/store";
import { plugin } from "./store";
import addExtension from "./utility/addExtension";
import { enforceMaxPathLength } from "./utility/enforceMaxPathLength";
import { createFileIfNotExists } from "./utility/createFileIfNotExists";
import { openNote } from "./ui/openNote";

/**
 * Resolve the on-disk path of a feed's note from the feed-note path template.
 * Always derived from the (stable) feed identity passed in, so the path never
 * shifts even if later metadata enrichment returns a slightly different title.
 */
function getFeedNotePath(feed: PodcastFeed): string {
	const pluginInstance = get(plugin);

	const filePath = FeedFilePathTemplateEngine(pluginInstance.settings.feedNote.path, feed);

	// Cap the path so a very long feed title can't trip ENAMETOOLONG (#22). Both
	// getFeedNote (existence/open) and createFeedNote derive the path here, so they
	// always agree on the capped result.
	return enforceMaxPathLength(addExtension(filePath, "md"));
}

export function getFeedNote(feed: PodcastFeed): TFile | null {
	const file = get(plugin).app.vault.getAbstractFileByPath(getFeedNotePath(feed));
	return file instanceof TFile ? file : null;
}

export function openFeedNote(feed: PodcastFeed): void {
	const file = getFeedNote(feed);

	if (!file) {
		new Notice(`Note for "${feed.title}" does not exist`);
		return;
	}

	void openNote(get(plugin).app, file);
}

export default async function createFeedNote(feed: PodcastFeed): Promise<void> {
	const pluginInstance = get(plugin);
	const { path, template } = pluginInstance.settings.feedNote;

	if (!path || !template) {
		new Notice("Please set a podcast feed note path and template in the settings.");
		return;
	}

	const existing = getFeedNote(feed);
	if (existing) {
		new Notice(`Note for "${feed.title}" already exists`);
		void openNote(get(plugin).app, existing);
		return;
	}

	const filePathDotMd = getFeedNotePath(feed);

	// Best-effort enrichment: fill description/website/author that a saved (or
	// synthesized) feed may lack. Never changes the title/basename and never
	// fails note creation when offline.
	const enrichedFeed = await enrichFeed(feed);
	const content = FeedNoteTemplateEngine(template, enrichedFeed);

	try {
		// Re-check immediately before creating: enrichment above awaits the network,
		// during which a second invocation (command + context menu) could have
		// created the note already.
		const existing = getFeedNote(feed);
		if (existing) new Notice(`Note for "${feed.title}" already exists`);
		const file = existing ?? (await createFileIfNotExists(filePathDotMd, content)).file;
		void openNote(get(plugin).app, file);
	} catch (error) {
		console.error(error);
		new Notice(`Failed to create note: "${filePathDotMd}"`);
	}
}

async function enrichFeed(feed: PodcastFeed): Promise<PodcastFeed> {
	const needsEnrichment = !feed.description || !feed.link || !feed.author;
	if (!needsEnrichment || !feed.url) {
		return feed;
	}

	try {
		const parsed = await get(plugin).feeds.channelAt(feed);

		// Keep the saved title/url/artwork; only backfill the new metadata fields
		// so the computed basename can never change mid-flight. Use `||` (not `??`)
		// so an empty-string saved field is also backfilled, matching the falsy
		// `needsEnrichment` gate above.
		return {
			...feed,
			description: feed.description || parsed.description,
			link: feed.link || parsed.link,
			author: feed.author || parsed.author,
		};
	} catch (error) {
		console.error("PodNotes: failed to enrich feed metadata", error);
		return feed;
	}
}
