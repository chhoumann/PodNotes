// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { SecretStorage, TFile } from "obsidian";
import { tick } from "svelte";
import { get } from "svelte/store";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	type Mock,
	onTestFinished,
	test,
	vi,
} from "vitest";
import type { ParsedFeedEpisodes, TranscriptLink } from "src/parser/feedDocumentParser";
import { FeedRepository } from "src/services/FeedRepository";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { plugin } from "src/store";
import type { Episode } from "src/types/Episode";
import { NetworkError } from "src/utility/networkRequest";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import type { FakeDocument } from "../../../tests/mocks/fakeMedia";
import { feedItem, MemoryStorage } from "../../../tests/mocks/feeds";
import type { Keymap as FakeKeymap } from "../../../tests/mocks/obsidian";
import { currentRowTop, layOut } from "../../../tests/mocks/panelLayout";
import {
	installResizeObserver,
	type FakeResizeObservers,
} from "../../../tests/mocks/resizeObserver";
import { createTestServices, type TestServices } from "../../../tests/mocks/services";
import PodcastView from "./PodcastView.svelte";

const fetchTextMock = vi.hoisted(() => vi.fn());

vi.mock("src/utility/networkRequest", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/utility/networkRequest")>()),
	fetchTextWithTimeout: fetchTextMock,
}));

const CUES: ReadonlyArray<readonly [string, string]> = [
	["Maya Lind", "Welcome back to Field Notes."],
	["Maya Lind", "Today we build a memory palace together."],
	["Ana Ilic", "Where does the palace start?"],
	["Ana Ilic", "At your own front door."],
	["Maya Lind", "Then every room holds one idea."],
	["Maya Lind", "The stranger the image, the longer it stays."],
	["Ana Ilic", "And spaced repetition does the rest."],
	["Ana Ilic", "Walk the Palace again a day later."],
	["Maya Lind", "Then a week later, then a month later."],
	["Maya Lind", "That is the whole method."],
];
const LINES = CUES.map(([, text]) => text);
const clock = (seconds: number) => `00:00:${String(seconds).padStart(2, "0")}.000`;
const VTT = `WEBVTT\n\n${CUES.map(
	([speaker, text], index) =>
		`${clock(index * 6)} --> ${clock(index * 6 + 6)}\n<v ${speaker}>${text}`,
).join("\n\n")}\n`;
const VTT_LINK: TranscriptLink = { url: "1.vtt", type: "text/vtt" };
const SECRET = "https://private.test/s3cret/feed.xml?auth=s3cret";

let services: TestServices;
let doc: FakeDocument;
let dispose: () => void;
let widths: FakeResizeObservers;
let feeds: FeedRepository;
let loadFeed: Mock<(url: string) => Promise<ParsedFeedEpisodes>>;
let episodes: Array<{ episode: Episode; transcripts: TranscriptLink[] }>;
let made = 0;

function episodeOf(transcripts: TranscriptLink[], overrides: Partial<Episode> = {}): Episode {
	made++;
	const episode: Episode = {
		title: `Episode ${made}`,
		streamUrl: `https://pod.test/${made}.mp3`,
		url: "",
		description: "",
		content: "",
		podcastName: "Field Notes",
		feedUrl: "https://pod.test/feed.xml",
		duration: 1800,
		...overrides,
	};
	episodes.push({ episode, transcripts });
	return episode;
}

beforeEach(() => {
	episodes = [];
	fetchTextMock.mockReset();
	fetchTextMock.mockResolvedValue(VTT);
	loadFeed = vi.fn(async () => ({
		feed: { title: "Field Notes" },
		episodes: episodes.map(({ episode, transcripts }) => ({
			...feedItem(episode),
			transcripts,
		})),
	}));
	feeds = new FeedRepository({
		load: loadFeed,
		resolveUrl: (feed) => feed.url,
		storage: new MemoryStorage(),
		now: Date.now,
	});
	({ services, doc, dispose } = createTestServices({ feeds }));
	services.library.savedFeeds.set({
		"Field Notes": { title: "Field Notes", url: "https://pod.test/feed.xml", artworkUrl: "" },
	});
	widths = installResizeObserver();
});

afterEach(() => {
	widths.uninstall();
	dispose();
	vi.restoreAllMocks();
});

async function openTranscript(played: Episode, time = 0, width = 320) {
	const result = render(PodcastView, { props: { services } });
	widths.resize(result.container.querySelector(".podcast-view")!, width);
	services.player.play(played);
	doc.media.duration = 1800;
	doc.media.emit("loadedmetadata");
	services.player.pause();
	doc.media.currentTime = time;
	doc.media.emit("timeupdate");
	services.navigation.expand();
	await tick();
	await fireEvent.click(switchButton("Transcript"));
	return result;
}

/** A transcript note saved before for `played`, and the spy that opens a note. */
function noteSavedBefore(played: Episode) {
	const { settings } = get(plugin);
	settings.transcript.path = "Transcripts/{{title}}.md";
	plugin.set(get(plugin));
	const saved = Object.assign(new TFile(), { path: `Transcripts/${played.title}.md` });
	Object.assign(services.app, {
		vault: { getFileByPath: (path: string) => (path === saved.path ? saved : null) },
	});
	const openFile = vi.fn((_file: TFile) => {});
	Object.assign(services.app.workspace, { getLeaf: vi.fn(() => ({ openFile })) });
	return { saved, openFile };
}

async function at(time: number) {
	doc.media.currentTime = time;
	doc.media.emit("timeupdate");
	await tick();
}

const switchButton = (name: string) =>
	within(screen.getByRole("group", { name: "Player panels" })).getByRole("button", { name });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const transcript = () => screen.findByRole("list", { name: "Transcript" });
const lineButton = (text: string) =>
	within(screen.getByRole("list", { name: "Transcript" })).getByRole("button", {
		name: new RegExp(`${text}$`),
	});
const rows = () =>
	within(screen.getByRole("list", { name: "Transcript" }))
		.getAllByRole("listitem")
		.map((row) => row.textContent?.replace(/\s+/g, " ").trim());
const currentLine = () =>
	within(screen.getByRole("list", { name: "Transcript" })).queryByRole("button", {
		current: true,
	})?.lastElementChild?.textContent;
const hitLine = () =>
	screen.getByRole("list", { name: "Transcript" }).querySelector(".is-hit")?.lastElementChild
		?.textContent;
const marks = () => [...document.querySelectorAll("mark")].map((mark) => mark.textContent);
const keymap = () => services.app.keymap as unknown as FakeKeymap;
const press = (key: string, target: Element = document.activeElement ?? document.body) => {
	const event = new KeyboardEvent("keydown", { key, bubbles: true });
	Object.defineProperty(event, "target", { value: target });
	keymap().dispatch(event);
};

describe("a published transcript", () => {
	test("lists its lines with their times and speakers, and marks the line playing now", async () => {
		await openTranscript(episodeOf([VTT_LINK]), 0);
		await transcript();

		expect(rows()).toEqual([
			"Maya Lind 0:00 Welcome back to Field Notes.",
			"0:06 Today we build a memory palace together.",
			"Ana Ilic 0:12 Where does the palace start?",
			"0:18 At your own front door.",
			"Maya Lind 0:24 Then every room holds one idea.",
			"0:30 The stranger the image, the longer it stays.",
			"Ana Ilic 0:36 And spaced repetition does the rest.",
			"0:42 Walk the Palace again a day later.",
			"Maya Lind 0:48 Then a week later, then a month later.",
			"0:54 That is the whole method.",
		]);
		expect(currentLine()).toBe(LINES[0]);
		await at(7);
		expect(currentLine()).toBe(LINES[1]);
		await at(43);
		expect(currentLine()).toBe(LINES[7]);

		await fireEvent.click(button("Find in transcript"));
		await fireEvent.input(screen.getByRole("searchbox", { name: "Find in transcript" }), {
			target: { value: "palace" },
		});
		expect(currentLine()).toBe(LINES[7]);
	});

	test("a tapped line plays from its start", async () => {
		await openTranscript(episodeOf([VTT_LINK]), 0);
		await transcript();
		expect(get(services.player.state).status).toBe("paused");

		await fireEvent.click(lineButton(LINES[6]));

		expect(get(services.player.state)).toMatchObject({ currentTime: 36, status: "playing" });
		expect(currentLine()).toBe(LINES[6]);
	});

	test("follows the line playing now until the user scrolls, then Follow brings it back", async () => {
		await openTranscript(episodeOf([VTT_LINK]), 0);
		const list = await transcript();
		layOut(list);

		await at(13);
		await tick();
		expect(list.scrollTop, "row 2, under row 1 and the faded edge").toBe(28);
		expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();

		list.scrollTop = 10;
		await tick();
		await tick();
		const follow = button("Follow");
		expect(follow.closest("[aria-live=polite]")).not.toBeNull();
		await at(19);
		await tick();
		expect(list.scrollTop, "the reader stays where they scrolled").toBe(10);

		await fireEvent.click(follow);
		await tick();
		expect(list.scrollTop, "row 3, under row 2 and the faded edge").toBe(68);
		expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
		expect(get(services.player.state).status).toBe("paused");
	});

	// Each case lists the panel's height, the rows' heights by index where not 40 px, and where
	// row 5, the line at 0:31, starts. The faded edges are 12 px at the top and 20 px at the bottom.
	test.each([
		["under the whole lines that fit in the panel's top third", 248, { 3: 30, 4: 30 }, 72],
		[
			"under just the line before it, where a third of the way down would cut the line above that",
			270,
			{ 4: 60 },
			72,
		],
		["lower, under the whole of a line before it that is taller", 248, { 4: 140, 5: 63 }, 152],
		["higher, above the faded bottom edge, when it is long too", 248, { 4: 100, 5: 140 }, 88],
		["just under the faded top edge when it is taller than the panel", 248, { 5: 300 }, 12],
	])("follows a line %s", async (_name, height, tall, top) => {
		await openTranscript(episodeOf([VTT_LINK]), 0);
		const list = await transcript();
		layOut(list, { height, tall });

		await at(31);
		await tick();

		expect(currentLine()).toBe(LINES[5]);
		expect(currentRowTop(list)).toBe(top);
	});

	test("keeps following when a taller panel pulls the list back, and stops when the reader scrolls", async () => {
		await openTranscript(episodeOf([VTT_LINK]), 0);
		const list = await transcript();
		const resize = layOut(list);
		await at(43);
		await tick();
		expect(list.scrollTop, "row 7, under row 6 and the faded edge").toBe(228);

		resize(200);
		await tick();
		await tick();
		expect(list.scrollTop, "the last scroll position the rows leave").toBe(200);
		expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();

		list.scrollTop = 150;
		await tick();
		await tick();
		expect(button("Follow")).toBeVisible();
	});

	test("Find shows the lines with a word, Enter and Shift+Enter step through them, and Escape closes Find before the player", async () => {
		await openTranscript(episodeOf([VTT_LINK]), 0);
		await transcript();
		await fireEvent.click(button("Find in transcript"));
		const field = screen.getByRole("searchbox", { name: "Find in transcript" });

		await fireEvent.input(field, { target: { value: "PALACE" } });
		expect(rows()).toEqual([
			"Maya Lind 0:06 Today we build a memory palace together.",
			"Ana Ilic 0:12 Where does the palace start?",
			"0:42 Walk the Palace again a day later.",
		]);
		expect(marks()).toEqual(["palace", "palace", "Palace"]);
		expect(hitLine()).toBe(LINES[1]);
		const step = async (shiftKey: boolean) => {
			await fireEvent.keyDown(field, { key: "Enter", shiftKey });
			return hitLine();
		};
		expect([await step(false), await step(false), await step(false)]).toEqual([
			LINES[2],
			LINES[7],
			LINES[1],
		]);
		expect([await step(true), await step(true)]).toEqual([LINES[7], LINES[2]]);

		await fireEvent.input(field, { target: { value: "zebra" } });
		expect(rows()).toEqual(["No lines match"]);

		press("Escape", field);
		await tick();
		expect(services.navigation.current.expanded, "the player stays open").toBe(true);
		expect(screen.queryByRole("searchbox")).toBeNull();
		expect(rows()).toHaveLength(10);
		expect(button("Find in transcript")).toHaveFocus();

		press("Escape");
		await tick();
		expect(services.navigation.current.expanded).toBe(false);
	});

	test("Find matches a dotted capital I as an i, and marks the letters it matched", async () => {
		fetchTextMock.mockResolvedValue(
			"WEBVTT\n\n00:00:00.000 --> 00:00:06.000\n\u0130stanbul calling, \u0130zmir next.\n",
		);
		await openTranscript(episodeOf([VTT_LINK]), 0);
		await transcript();
		await fireEvent.click(button("Find in transcript"));
		const field = screen.getByRole("searchbox", { name: "Find in transcript" });

		await fireEvent.input(field, { target: { value: "stanbul" } });
		expect(marks()).toEqual(["stanbul"]);
		await fireEvent.input(field, { target: { value: "IZMIR" } });
		expect(marks()).toEqual(["\u0130zmir"]);
	});

	test("another episode's transcript opens with Find closed and every line shown", async () => {
		const second = episodeOf([VTT_LINK]);
		await openTranscript(episodeOf([VTT_LINK]), 0);
		await transcript();
		await fireEvent.click(button("Find in transcript"));
		await fireEvent.input(screen.getByRole("searchbox", { name: "Find in transcript" }), {
			target: { value: "palace" },
		});
		expect(rows()).toHaveLength(3);

		services.player.play(second);
		await tick();

		await vi.waitFor(() => expect(rows()).toHaveLength(LINES.length));
		expect(screen.queryByRole("searchbox", { name: "Find in transcript" })).toBeNull();
		expect(marks()).toEqual([]);
	});

	test("Save as note hands the note to the transcribe command and writes nothing itself", async () => {
		const vault = {
			getFileByPath: () => null,
			create: vi.fn(),
			modify: vi.fn(),
			process: vi.fn(),
		};
		Object.assign(services.app, { vault });
		await openTranscript(episodeOf([VTT_LINK]), 0);
		await transcript();
		expect(
			button("Save as note"),
			"named by its label, with no aria-label that Obsidian would show as a tooltip",
		).not.toHaveAttribute("aria-label");

		await fireEvent.click(button("Save as note"));

		expect(services.saveTranscriptNote).toHaveBeenCalledExactlyOnceWith();
		expect([vault.create, vault.modify, vault.process].map((spy) => spy.mock.calls)).toEqual([
			[],
			[],
			[],
		]);
		expect(fetchTextMock).toHaveBeenCalledOnce();
		services.online.set(false);
		await tick();
		expect(button("Save as note")).toBeDisabled();
	});

	test("opens the note saved before, also offline, instead of saving it again, as long as it is there", async () => {
		const { settings } = get(plugin);
		settings.transcript.path = "Transcripts/{{title}}.md";
		plugin.set(get(plugin));
		const notes = new Map<string, TFile>();
		const note = (folder: string, { title }: Episode) =>
			Object.assign(new TFile(), { path: `${folder}/${title}.md` });
		Object.assign(services.app, {
			vault: { getFileByPath: (path: string) => notes.get(path) ?? null },
		});
		const openFile = vi.fn((_file: TFile) => {});
		Object.assign(services.app.workspace, { getLeaf: vi.fn(() => ({ openFile })) });
		const played = episodeOf([VTT_LINK]);
		const saved = note("Transcripts", played);
		notes.set(saved.path, saved);
		await openTranscript(played, 0);
		await transcript();
		services.online.set(false);
		await tick();

		expect(button("Open note")).toBeEnabled();
		await fireEvent.click(button("Open note"));
		expect(openFile).toHaveBeenCalledExactlyOnceWith(saved);
		expect(services.saveTranscriptNote).not.toHaveBeenCalled();

		notes.clear();
		services.rowHasNote.set(() => false);
		await tick();
		expect(button("Save as note"), "deleted, and offline").toBeDisabled();

		const moved = note("Elsewhere", played);
		notes.set(moved.path, moved);
		settings.transcript.path = "Elsewhere/{{title}}.md";
		plugin.set(get(plugin));
		await tick();
		await fireEvent.click(button("Open note"));
		expect(openFile).toHaveBeenLastCalledWith(moved);
	});

	test("Save as note saves a video's feed transcript too, which needs no audio", async () => {
		await openTranscript(episodeOf([VTT_LINK], { mediaType: "video" }), 0);
		await transcript();

		await fireEvent.click(button("Save as note"));

		expect(services.saveTranscriptNote).toHaveBeenCalledExactlyOnceWith();
	});

	test("an untimed transcript reads as paragraphs, with no time to play from or follow", async () => {
		fetchTextMock.mockResolvedValue("First paragraph.\n\nSecond paragraph.");
		await openTranscript(episodeOf([{ url: "1.txt", type: "text/plain" }]), 30);
		const list = await transcript();

		list.scrollTop = 30;
		await fireEvent.scroll(list);

		expect(rows()).toEqual(["First paragraph.", "Second paragraph."]);
		expect(within(list).queryAllByRole("button")).toEqual([]);
		expect(list.querySelector("[aria-current]")).toBeNull();
		expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();

		await fireEvent.click(button("Find in transcript"));
		const field = screen.getByRole("searchbox", { name: "Find in transcript" });
		await fireEvent.input(field, { target: { value: "paragraph" } });
		await fireEvent.keyDown(field, { key: "Enter" });
		expect(
			screen
				.getByRole("list", { name: "Transcript" })
				.querySelector(".is-hit")
				?.textContent?.trim(),
		).toBe("Second paragraph.");
	});

	test("shows once loaded: back from Up next it neither loads again nor fetches again", async () => {
		let answer!: (text: string) => void;
		fetchTextMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
		await openTranscript(episodeOf([VTT_LINK]), 0);
		expect(await screen.findByText("Loading transcript")).toHaveAttribute("role", "status");
		answer(VTT);
		await transcript();

		await fireEvent.click(switchButton("Up next"));
		await fireEvent.click(switchButton("Transcript"));

		expect(screen.getByRole("list", { name: "Transcript" })).toBeInTheDocument();
		expect(screen.queryByText("Loading transcript")).toBeNull();
		expect(fetchTextMock).toHaveBeenCalledOnce();
	});
});

describe("a transcript that did not load", () => {
	test("offers Retry, which fetches it again", async () => {
		fetchTextMock.mockRejectedValueOnce(new NetworkError("unexpected-status", 500));
		await openTranscript(episodeOf([VTT_LINK]), 0);
		await screen.findByText("Transcript didn't load");
		expect(screen.getByRole("alert").querySelector("[data-icon]")).toHaveAttribute(
			"data-icon",
			"alert-triangle",
		);

		await fireEvent.click(button("Retry"));

		await transcript();
		expect(fetchTextMock).toHaveBeenCalledTimes(2);
	});

	test("never shows or logs a private feed's address from the failure", async () => {
		const logged = (["error", "warn", "info", "log", "debug"] as const).map((level) =>
			vi.spyOn(console, level),
		);
		vi.spyOn(feeds, "itemUrl").mockImplementation(() => {
			throw new Error(`Could not resolve 1.vtt against ${SECRET}`);
		});
		const { container } = await openTranscript(episodeOf([VTT_LINK]), 0);
		await screen.findByText("Transcript didn't load");

		expect(container.innerHTML).not.toContain("s3cret");
		expect(JSON.stringify(logged.map((spy) => spy.mock.calls))).not.toContain("s3cret");
	});

	test("never shows the private feed address a saved private feed's transcript quotes", async () => {
		const feedUrls = new FeedUrlRepository(new SecretStorage());
		const urlSecretId = feedUrls.store(SECRET);
		const placeholder = privateFeedPlaceholder("Field Notes");
		const host = get(plugin);
		plugin.set({
			...host,
			feedUrls,
			settings: {
				...host.settings,
				savedFeeds: {
					"Field Notes": {
						title: "Field Notes",
						url: placeholder,
						urlSecretId,
						artworkUrl: "",
					},
				},
			},
		} as never);
		onTestFinished(() => plugin.set(host));
		fetchTextMock.mockResolvedValue(
			`WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n<v Host>Your feed is ${SECRET}\n`,
		);
		const { container } = await openTranscript(
			episodeOf([VTT_LINK], { feedUrl: placeholder }),
			0,
		);
		await transcript();

		expect(rows()).toEqual([`Host 0:00 Your feed is ${placeholder}`]);
		expect(container.innerHTML).not.toContain("s3cret");
	});

	test("with a note saved before, offers Open note beside Retry, also offline", async () => {
		fetchTextMock.mockRejectedValueOnce(new NetworkError("unexpected-status", 500));
		const played = episodeOf([VTT_LINK]);
		const { saved, openFile } = noteSavedBefore(played);
		await openTranscript(played, 0);
		await screen.findByText("Transcript didn't load");
		services.online.set(false);
		await tick();

		await fireEvent.click(button("Open note"));

		expect(openFile).toHaveBeenCalledExactlyOnceWith(saved);
		expect(services.saveTranscriptNote).not.toHaveBeenCalled();
		expect(button("Retry")).toBeVisible();
	});

	test("when the feed itself did not load, offers Retry, not the paid transcription", async () => {
		const served = loadFeed.getMockImplementation()!;
		loadFeed.mockRejectedValue(new Error("offline"));
		await openTranscript(episodeOf([VTT_LINK]), 0);

		await screen.findByText("Transcript didn't load");
		expect(screen.queryByRole("button", { name: /^Transcribe with/ })).toBeNull();
		loadFeed.mockImplementation(served);
		await fireEvent.click(button("Retry"));
		await transcript();
	});
});

describe("an episode whose feed publishes no transcript", () => {
	test("offers the paid transcription, off while offline", async () => {
		await openTranscript(episodeOf([]), 0);
		const empty = (await screen.findByText("No transcript in this feed")).parentElement!;
		expect(empty).not.toHaveAttribute("role");
		expect(empty.querySelector("[data-icon]")).toHaveAttribute("data-icon", "captions");
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		const paid = button("Transcribe with OpenAI Paid");

		await fireEvent.click(paid);
		expect(services.transcribeFromAudio).toHaveBeenCalledExactlyOnceWith();

		services.online.set(false);
		await tick();
		expect(paid).toBeDisabled();
	});

	test("with a transcript note saved before, offers Open note instead of the paid transcription", async () => {
		const played = episodeOf([]);
		const { saved, openFile } = noteSavedBefore(played);
		await openTranscript(played, 0);
		await screen.findByText("No transcript in this feed");
		expect(button("Open note"), "named by its label, with no tooltip").not.toHaveAttribute(
			"aria-label",
		);

		await fireEvent.click(button("Open note"));

		expect(openFile).toHaveBeenCalledExactlyOnceWith(saved);
		expect(screen.queryByRole("button", { name: /^Transcribe with/ })).toBeNull();
		expect(services.transcribeFromAudio).not.toHaveBeenCalled();
		expect(services.saveTranscriptNote).not.toHaveBeenCalled();
	});

	test("names Deepgram when diarization uses it", async () => {
		const { settings } = get(plugin);
		settings.transcript.diarization = {
			...settings.transcript.diarization,
			enabled: true,
			provider: "deepgram",
		};
		plugin.update((host) => host);
		await openTranscript(episodeOf([]), 0);

		expect(
			await screen.findByRole("button", { name: /^Transcribe with/ }),
		).toHaveAccessibleName("Transcribe with Deepgram Paid");
	});

	test("offers no paid transcription for a video", async () => {
		await openTranscript(episodeOf([], { mediaType: "video" }), 0);

		await screen.findByText("No transcript in this feed");
		expect(screen.queryByRole("button", { name: /^Transcribe with/ })).toBeNull();
	});
});
