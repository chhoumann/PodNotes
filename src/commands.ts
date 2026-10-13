import { Notice } from "obsidian";
import { get } from "svelte/store";
import { queue, savedFeeds } from "src/store";
import { QueueReorderModal } from "src/ui/QueueReorderModal";
import createPodcastNote from "src/createPodcastNote";
import createFeedNote from "src/createFeedNote";
import { PickerModal, orderFeedsByCurrent } from "src/ui/PickerModal";
import downloadEpisodeWithNotice from "src/downloadEpisode";
import getUniversalPodcastLink from "src/getUniversalPodcastLink";
import { getEpisodeMediaType } from "src/utility/mediaType";
import { TRANSCRIBE_FROM_AUDIO_COMMAND } from "src/services/TranscriptionService";
import type PodNotes from "src/main";
import type { PodcastFeed } from "src/types/PodcastFeed";

/**
 * Registers every PodNotes command on the plugin. Extracted from main.onload so
 * the plugin entry point stays focused on lifecycle wiring; each command reads
 * live state off the passed plugin (api/settings/app) at invocation time.
 */
export function registerCommands(plugin: PodNotes): void {
	plugin.addCommand({
		id: "podnotes-show-leaf",
		name: "Show player",
		icon: "podcast",
		// Always available, and always reveals the view. The previous
		// checkCallback hid this command whenever a leaf already existed, so
		// once the view was open-but-hidden (collapsed sidebar, sidebar
		// overflow, dragged out of sight) there was no way to bring it back
		// (#55). activateView reuses the existing leaf and reveals it.
		callback: () => {
			void plugin.activateView();
		},
	});

	plugin.addCommand({
		id: "start-playing",
		name: "Play Podcast",
		icon: "play-circle",
		checkCallback: (checking) => {
			if (checking) {
				return !plugin.api.isPlaying && !!plugin.api.podcast;
			}

			plugin.api.start();
		},
	});

	plugin.addCommand({
		id: "stop-playing",
		name: "Stop Podcast",
		icon: "stop-circle",
		checkCallback: (checking) => {
			if (checking) {
				return plugin.api.isPlaying && !!plugin.api.podcast;
			}

			plugin.api.stop();
		},
	});

	plugin.addCommand({
		id: "skip-backward",
		name: "Skip Backward",
		icon: "skip-back",
		checkCallback: (checking) => {
			// Skipping only seeks the position, so it is available whenever an
			// episode is loaded, paused or playing, matching the always-active
			// on-screen skip buttons (previously these commands required isPlaying,
			// so a hotkey silently did nothing while paused). See PB-02.
			if (checking) {
				return !!plugin.api.podcast;
			}

			plugin.api.skipBackward();
		},
	});

	plugin.addCommand({
		id: "skip-forward",
		name: "Skip Forward",
		icon: "skip-forward",
		checkCallback: (checking) => {
			if (checking) {
				return !!plugin.api.podcast;
			}

			plugin.api.skipForward();
		},
	});

	plugin.addCommand({
		id: "download-playing-episode",
		name: "Download Playing Episode",
		icon: "download",
		checkCallback: (checking) => {
			if (checking) {
				return !!plugin.api.podcast;
			}

			const episode = plugin.api.podcast;
			// Settle the promise so a failed download surfaces in its own Notice
			// without leaving an unhandled rejection (DL-01). The notice itself is
			// the user-facing error; the log aids diagnosis.
			void downloadEpisodeWithNotice(episode, plugin.settings.download.path).catch((error) =>
				console.error("PodNotes: download failed", error),
			);
		},
	});

	plugin.addCommand({
		id: "reorder-queue",
		name: "Reorder Queue",
		icon: "list-ordered",
		checkCallback: (checking) => {
			if (checking) {
				return get(queue).episodes.length > 1;
			}

			new QueueReorderModal(plugin.app).open();
		},
	});

	// Plain callbacks: with no editor focused a capture goes to the episode note, and
	// a check would hide them from the mobile toolbar's picker until an episode loads.
	plugin.addCommand({
		id: "capture-timestamp",
		name: "Capture Timestamp",
		icon: "clock",
		callback: () => {
			void plugin.capture.timestamp();
		},
	});

	plugin.addCommand({
		id: "capture-segment-10s",
		name: "Capture Last 10 Seconds",
		icon: "scissors",
		callback: () => {
			void plugin.capture.segment(10);
		},
	});

	plugin.addCommand({
		id: "capture-segment-20s",
		name: "Capture Last 20 Seconds",
		icon: "scissors",
		callback: () => {
			void plugin.capture.segment(20);
		},
	});

	plugin.addCommand({
		id: "create-podcast-note",
		// Despite the id, this creates an episode note: the loaded episode's, else one
		// picked from a saved podcast. The visible name was corrected to disambiguate
		// it from the feed-level "Create podcast feed note" command below (issue
		// #163). The id is kept for backward compatibility (hotkeys/API).
		name: "Create episode note",
		icon: "file-plus",
		checkCallback: (checking) => {
			const { path, template } = plugin.settings.note;
			const episode = plugin.api.podcast;
			const feeds = Object.values(get(savedFeeds));
			if (checking) {
				return !!path && !!template && (!!episode || feeds.length > 0);
			}

			if (episode) {
				void createPodcastNote(episode);
				return;
			}

			new PickerModal(
				plugin.app,
				feeds,
				(feed) => feed.title,
				"Select a podcast",
				(feed) => {
					void pickEpisodeForNote(plugin, feed);
				},
			).open();
		},
	});

	plugin.addCommand({
		id: "create-podcast-feed-note",
		name: "Create podcast feed note",
		icon: "file-plus",
		checkCallback: (checking) => {
			const feeds = Object.values(get(savedFeeds));
			const canCreate =
				feeds.length > 0 &&
				!!plugin.settings.feedNote.path &&
				!!plugin.settings.feedNote.template;

			if (checking) {
				return canCreate;
			}

			if (!canCreate) return;

			// Pre-select the playing episode's feed when there is one, so the
			// picker opens on the most likely choice without requiring playback.
			const orderedFeeds = orderFeedsByCurrent(feeds, plugin.api.podcast?.podcastName);

			new PickerModal(
				plugin.app,
				orderedFeeds,
				(feed) => feed.title,
				"Select a podcast to create or open its note",
				(feed) => {
					void createFeedNote(feed);
				},
			).open();
		},
	});

	plugin.addCommand({
		id: "get-share-link-episode",
		name: "Copy universal episode link to clipboard",
		icon: "share",
		checkCallback: (checking) => {
			if (checking) {
				return !!plugin.api.podcast;
			}

			void getUniversalPodcastLink(plugin.api);
		},
	});

	plugin.addCommand({
		id: "podnotes-toggle-playback",
		name: "Toggle playback",
		icon: "play",
		checkCallback: (checking) => {
			if (checking) {
				return !!plugin.api.podcast;
			}

			plugin.api.togglePlayback();
		},
	});

	plugin.addCommand({
		id: "increase-playback-rate",
		name: "Increase playback rate",
		icon: "gauge",
		checkCallback: (checking) => {
			if (checking) {
				return !!plugin.api.podcast;
			}

			plugin.api.increasePlaybackRate();
		},
	});

	plugin.addCommand({
		id: "decrease-playback-rate",
		name: "Decrease playback rate",
		icon: "gauge",
		checkCallback: (checking) => {
			if (checking) {
				return !!plugin.api.podcast;
			}

			plugin.api.decreasePlaybackRate();
		},
	});

	plugin.addCommand({
		id: "reset-playback-rate",
		name: "Reset playback rate",
		icon: "rotate-ccw",
		checkCallback: (checking) => {
			if (checking) {
				return !!plugin.api.podcast;
			}

			plugin.api.resetPlaybackRate();
		},
	});

	const canTranscribe = () =>
		!!plugin.api.podcast && getEpisodeMediaType(plugin.api.podcast) === "audio";

	plugin.addCommand({
		id: "podnotes-transcribe",
		name: "Transcribe current episode",
		checkCallback: (checking) => {
			if (checking) {
				return canTranscribe();
			}

			if (canTranscribe()) {
				void plugin.getTranscriptionService().transcribeCurrentEpisode();
			}
		},
	});

	plugin.addCommand({
		id: "podnotes-transcribe-audio",
		name: TRANSCRIBE_FROM_AUDIO_COMMAND,
		checkCallback: (checking) => {
			if (checking) {
				return canTranscribe();
			}

			if (canTranscribe()) {
				plugin.getTranscriptionService().transcribeCurrentEpisodeFromAudio();
			}
		},
	});
}

async function pickEpisodeForNote(plugin: PodNotes, feed: PodcastFeed): Promise<void> {
	await plugin.feeds.load([feed.title], "cached");
	const state = get(plugin.feeds).get(feed.title);
	const episodes = state?.episodes ?? [];
	if (episodes.length === 0) {
		new Notice(
			state?.error ? "Could not load the podcast feed" : "No episodes in this podcast",
		);
		return;
	}

	new PickerModal(
		plugin.app,
		episodes,
		(episode) => episode.title,
		"Select an episode",
		(episode) => {
			void createPodcastNote(episode);
		},
	).open();
}
