import { Notice, type Editor } from "obsidian";
import { get } from "svelte/store";
import { queue, savedFeeds } from "src/store";
import { QueueReorderModal } from "src/ui/QueueReorderModal";
import { TimestampTemplateEngine } from "src/TemplateEngine";
import { prepareTimestampForInsertion } from "src/utility/prepareTimestampInsertion";
import { createRecentPodcastSegment, getSegmentCaptureTemplate } from "src/utility/podcastSegment";
import createPodcastNote from "src/createPodcastNote";
import createFeedNote from "src/createFeedNote";
import { FeedSuggestModal, orderFeedsByCurrent } from "src/ui/FeedSuggestModal";
import downloadEpisodeWithNotice from "src/downloadEpisode";
import getUniversalPodcastLink from "src/getUniversalPodcastLink";
import { getEpisodeMediaType } from "src/utility/mediaType";
import type { IconType } from "src/types/IconType";
import type PodNotes from "src/main";

/**
 * Registers every PodNotes command on the plugin. Extracted from main.onload so
 * the plugin entry point stays focused on lifecycle wiring; each command reads
 * live state off the passed plugin (api/settings/app) at invocation time.
 */
export function registerCommands(plugin: PodNotes): void {
	const canCaptureTimestamp = () => !!plugin.api.podcast && !!plugin.settings.timestamp.template;
	const insertCapture = (editor: Editor, capture: string) => {
		// Insert with replaceSelection (not getCursor + replaceRange +
		// setCursor): it drops the text at the live cursor and lets the
		// editor place the caret after it, which is reliable inside Live
		// Preview table cells where hand-computed positions land in the
		// wrong cell. Inside a table the capture is escaped so pipes and
		// newlines don't break the row. See issue #165.
		const cursor = editor.getCursor("from");
		const textToInsert = prepareTimestampForInsertion(capture, {
			getLine: (line) => editor.getLine(line),
			lineCount: editor.lineCount(),
			cursorLine: cursor.line,
		});

		editor.replaceSelection(textToInsert);
	};
	const captureRecentSegment = (editor: Editor, lengthSeconds: number) => {
		const segment = createRecentPodcastSegment(
			plugin.api.currentTime,
			lengthSeconds,
			plugin.settings.timestamp.offset ?? 0,
		);

		if (!segment) {
			new Notice("Play more of the episode before capturing a segment");
			return;
		}

		const capture = TimestampTemplateEngine(
			getSegmentCaptureTemplate(plugin.settings.timestamp.template),
			{ segment },
		);
		insertCapture(editor, capture);
	};

	plugin.addCommand({
		id: "podnotes-show-leaf",
		name: "Show player",
		icon: "podcast" as IconType,
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
		icon: "play-circle" as IconType,
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
		icon: "stop-circle" as IconType,
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
		icon: "skip-back" as IconType,
		checkCallback: (checking) => {
			// Skipping only seeks the position, so it is available whenever an
			// episode is loaded — paused or playing — matching the always-active
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
		icon: "skip-forward" as IconType,
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
		icon: "download" as IconType,
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
		icon: "list-ordered" as IconType,
		checkCallback: (checking) => {
			if (checking) {
				return get(queue).episodes.length > 1;
			}

			new QueueReorderModal(plugin.app).open();
		},
	});

	plugin.addCommand({
		id: "capture-timestamp",
		name: "Capture Timestamp",
		icon: "clock" as IconType,
		// Keep this an editorCallback (not editorCheckCallback): an unconditional
		// editor command stays addable to the mobile editor toolbar / command
		// picker even before an episode is loaded, whereas a checkCallback that
		// returns false would filter it out (and an e2e test pins this). Surface a
		// Notice when capture isn't possible instead of silently no-opping (TS-01).
		editorCallback: (editor) => {
			if (plugin.captureTimestamp(editor)) {
				return;
			}

			new Notice(
				"Play an episode and set a Capture timestamp format in settings to capture a timestamp.",
			);
		},
	});

	plugin.addCommand({
		id: "capture-segment-10s",
		name: "Capture Last 10 Seconds",
		icon: "scissors" as IconType,
		editorCheckCallback: (checking, editor) => {
			if (checking) {
				return canCaptureTimestamp();
			}

			captureRecentSegment(editor, 10);
		},
	});

	plugin.addCommand({
		id: "capture-segment-20s",
		name: "Capture Last 20 Seconds",
		icon: "scissors" as IconType,
		editorCheckCallback: (checking, editor) => {
			if (checking) {
				return canCaptureTimestamp();
			}

			captureRecentSegment(editor, 20);
		},
	});

	plugin.addCommand({
		id: "create-podcast-note",
		// Despite the id, this creates a note for the CURRENT EPISODE. The
		// visible name was corrected to disambiguate it from the feed-level
		// "Create podcast feed note" command below (issue #163). The id is kept
		// for backward compatibility (hotkeys/API).
		name: "Create episode note",
		icon: "file-plus" as IconType,
		checkCallback: (checking) => {
			if (checking) {
				return (
					!!plugin.api.podcast &&
					!!plugin.settings.note.path &&
					!!plugin.settings.note.template
				);
			}

			void createPodcastNote(plugin.api.podcast);
		},
	});

	plugin.addCommand({
		id: "create-podcast-feed-note",
		name: "Create podcast feed note",
		icon: "file-plus" as IconType,
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

			new FeedSuggestModal(plugin.app, orderedFeeds, (feed) => {
				void createFeedNote(feed);
			}).open();
		},
	});

	plugin.addCommand({
		id: "get-share-link-episode",
		name: "Copy universal episode link to clipboard",
		icon: "share" as IconType,
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
		icon: "play" as IconType,
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
		icon: "gauge" as IconType,
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
		icon: "gauge" as IconType,
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
		icon: "rotate-ccw" as IconType,
		checkCallback: (checking) => {
			if (checking) {
				return !!plugin.api.podcast;
			}

			plugin.api.resetPlaybackRate();
		},
	});

	plugin.addCommand({
		id: "podnotes-transcribe",
		name: "Transcribe current episode",
		checkCallback: (checking) => {
			// Don't gate availability on the API key: keep the command offered
			// whenever an audio episode is loaded so running it without a key shows
			// the service's context-aware "set your API key" Notice instead of the
			// command silently vanishing with no explanation (TR-02).
			const canTranscribe =
				!!plugin.api.podcast && getEpisodeMediaType(plugin.api.podcast) === "audio";

			if (checking) {
				return canTranscribe;
			}

			if (canTranscribe) {
				void plugin.getTranscriptionService().transcribeCurrentEpisode();
			}
		},
	});
}
