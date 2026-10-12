import { describe, expect, test } from "vitest";
import type { Episode } from "src/types/Episode";
import { transcriptFixture } from "../../../tests/mocks/transcriptFixtures";
import { type NonEmpty, parseTranscript, type TranscriptCue } from "./parse";
import { escapeTranscriptText, groupCues, renderTranscriptBody, timestampStyle } from "./render";

const episode: Episode = {
	title: "Pilot",
	streamUrl: "https://pod.example.com/1.mp3",
	url: "",
	description: "",
	content: "",
	podcastName: "Feed Podcast",
	feedUrl: "https://pod.example.com/feed.xml",
};
const link = (time: string) =>
	`obsidian://podnotes?episodeName=Pilot&url=https%3A%2F%2Fpod.example.com%2Ffeed.xml&time=${time}`;

const cues: NonEmpty<TranscriptCue> = [
	{ start: 0.48, end: 4.41, speaker: "Justin", text: "Hello there." },
	{ start: 4.41, end: 9, text: "Still Justin." },
	{ start: 10.16, end: 12, speaker: "Michael", text: "Hi!" },
];

function render(timestampTemplate: string, speakerTemplate = "**{{speaker}}:** "): string {
	return renderTranscriptBody(
		{ kind: "timed", cues },
		{ episode, speakerTemplate, timestamp: timestampStyle(timestampTemplate) },
	);
}

describe("renderTranscriptBody", () => {
	test("links each paragraph to the episode at its first cue's exact start", () => {
		expect(render("- {{linktime}} ")).toBe(
			`[00:00:00](${link("0.48")}) **Justin:** Hello there. Still Justin.\n\n` +
				`[00:00:10](${link("10.16")}) **Michael:** Hi!`,
		);
	});

	test("plain times when the timestamp template asks for {{time}}", () => {
		expect(render("{{time}} ")).toBe(
			"00:00:00 **Justin:** Hello there. Still Justin.\n\n00:00:10 **Michael:** Hi!",
		);
	});

	test("the first time tag's format, here {{linktime:mm:ss}}", () => {
		expect(render("{{linktime:mm:ss}} then {{time:H}}")).toBe(
			`[00:00](${link("0.48")}) **Justin:** Hello there. Still Justin.\n\n` +
				`[00:10](${link("10.16")}) **Michael:** Hi!`,
		);
	});

	test("the speaker template shapes the label, and an empty one falls back to the default", () => {
		expect(render("{{time}}", "> {{speaker}} - ")).toBe(
			"00:00:00 > Justin - Hello there. Still Justin.\n\n00:00:10 > Michael - Hi!",
		);
		expect(render("{{time}}", "")).toBe(render("{{time}}"));
	});

	test("an untimed transcript is its escaped paragraphs", () => {
		expect(
			renderTranscriptBody(
				{ kind: "untimed", paragraphs: ["Justin: Hi #1.", "Michael: Hey."] },
				{ episode, speakerTemplate: "", timestamp: timestampStyle("{{linktime}}") },
			),
		).toBe("Justin: Hi \\#1.\n\nMichael: Hey.");
	});

	test("feed text and speakers are escaped", () => {
		expect(
			renderTranscriptBody(
				{ kind: "timed", cues: [{ start: 1, speaker: "<b>Eve</b>", text: "![[x]]" }] },
				{ episode, speakerTemplate: "", timestamp: timestampStyle("{{time}}") },
			),
		).toBe("00:00:01 **\\<b>Eve\\</b>:** !\\[\\[x]]");
	});

	test("an entity the feed escaped stays literal and a prose & stays plain", () => {
		const vtt =
			"WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFable &amp; Folly wrote &amp;lt;b&amp;gt; and &amp;#39;\n";

		expect(
			renderTranscriptBody(parseTranscript("vtt", vtt)!, {
				episode,
				speakerTemplate: "",
				timestamp: timestampStyle("{{time}}"),
			}),
		).toBe("00:00:01 Fable & Folly wrote \\&lt;b\\&gt; and \\&\\#39;");
	});
});

describe("timestampStyle", () => {
	test.each([
		["- {{linktime}} ", { format: "HH:mm:ss", linkify: true }],
		["{{LinkTime:mm:ss}}", { format: "mm:ss", linkify: true }],
		["{{linksegment}}", { format: "HH:mm:ss", linkify: true }],
		["{{time:H:mm}} {{linktime:mm:ss}}", { format: "H:mm", linkify: false }],
		["{{linktime:}}", { format: "HH:mm:ss", linkify: true }],
		["> ", { format: "HH:mm:ss", linkify: false }],
	])("%j", (template, style) => {
		expect(timestampStyle(template)).toEqual(style);
	});
});

describe("groupCues", () => {
	type Span = [start: number, end: number, text: string];
	const cue = ([start, end, text]: Span): TranscriptCue => ({ start, end, text });
	const speakerless = (first: Span, ...rest: Span[]): NonEmpty<TranscriptCue> => [
		cue(first),
		...rest.map(cue),
	];

	test("Buzzcast word-level JSON becomes its three speaker turns", () => {
		const parsed = parseTranscript("json", transcriptFixture("buzzcast.json"));
		if (parsed?.kind !== "timed") throw new Error("Expected timed cues");

		expect(groupCues(parsed.cues)).toEqual([
			{
				start: 0.16,
				end: 15.04,
				speaker: "Alban",
				text: "Moments ago, I just hit a professional milestone, a new accomplishment. All right, I'm gonna be using air quotes for this, but the first code that I ever wrote, and I'm now using air quotes for I wrote is now live in Buzzsprout as of like four minutes ago.",
			},
			{
				start: 15.2,
				end: 17.28,
				speaker: "Kevin",
				text: "Oh, your PR got accepted and merged?",
			},
			{ start: 17.44, end: 18.32, speaker: "Alban", text: "It's merged." },
		]);
	});

	test("a silence of 5 s starts a paragraph and a shorter one does not", () => {
		expect(
			groupCues(speakerless([0, 4, "One."], [8.9, 10, "Two."], [15, 16, "Three."])).map(
				(paragraph) => paragraph.text,
			),
		).toEqual(["One. Two.", "Three."]);
	});

	test("after 30 s a paragraph ends at a sentence end", () => {
		expect(
			groupCues(
				speakerless(
					[0, 10, "a"],
					[10, 20, "b"],
					[20, 29.9, "c."],
					[29.9, 30, "d."],
					[30, 31, "e"],
				),
			).map((paragraph) => paragraph.text),
		).toEqual(["a b c. d.", "e"]);
	});

	test("after 60 s a paragraph ends even mid-sentence, and a long cue stays whole", () => {
		expect(
			groupCues(
				speakerless(
					[0, 10, "a"],
					[10, 20, "b"],
					[20, 30, "c"],
					[30, 40, "d"],
					[40, 50, "e"],
					[50, 59.9, "f"],
					[59.9, 60, "g"],
					[60, 130, "h"],
					[130, 131, "i"],
				),
			).map((paragraph) => paragraph.text),
		).toEqual(["a b c d e f g", "h", "i"]);
	});

	test("a new speaker starts a paragraph and a cue without one continues it", () => {
		expect(
			groupCues([
				{ start: 0, end: 1, speaker: "A", text: "One." },
				{ start: 1, end: 2, text: "Two." },
				{ start: 2, end: 3, speaker: "B", text: "Three." },
				{ start: 3, end: 4, speaker: "B", text: "Four." },
			]).map(({ speaker, text }) => [speaker, text]),
		).toEqual([
			["A", "One. Two."],
			["B", "Three. Four."],
		]);
	});
});

describe("escapeTranscriptText", () => {
	test("makes embeds, HTML, code, Dataview, tags, math and comments inert", () => {
		expect(
			escapeTranscriptText(
				"![[x]] <img src=x> `= this.file` ~~~dataviewjs #tag $5 and $10 %%c%% C:\\path",
			),
		).toBe(
			"!\\[\\[x]] \\<img src=x> \\`= this.file\\` \\~\\~\\~dataviewjs \\#tag \\$5 and \\$10 \\%\\%c\\%\\% C:\\\\path",
		);
	});

	test("keeps prose punctuation readable and puts the text on one line", () => {
		expect(escapeTranscriptText("  It's 3.5 - well,\n\tnot *quite*.  ")).toBe(
			"It's 3.5 - well, not *quite*.",
		);
	});
});
