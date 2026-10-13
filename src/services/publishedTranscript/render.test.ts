import { describe, expect, test } from "vitest";
import type { Episode } from "src/types/Episode";
import { transcriptFixture } from "../../../tests/mocks/transcriptFixtures";
import { type NonEmpty, parseTranscript, type TranscriptCue } from "./parse";
import {
	escapeTranscriptText,
	groupCues,
	MAX_PARAGRAPH_LENGTH,
	renderTranscriptBody,
	timestampStyle,
} from "./render";

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

	test("block IDs and Dataview fields in feed text and speakers stay prose", () => {
		const options = { episode, speakerTemplate: "", timestamp: timestampStyle("{{time}}") };

		expect(
			renderTranscriptBody(
				{
					kind: "timed",
					cues: [
						{
							start: 1,
							speaker: "host:: Eve ^v420-speaker",
							text: "Said ^v420-cue and v420-field:: injected value",
						},
					],
				},
				options,
			),
		).toBe(
			"00:00:01 **host:\\: Eve \\^v420-speaker:** Said \\^v420-cue and v420-field:\\: injected value",
		);
		expect(
			renderTranscriptBody(
				{
					kind: "untimed",
					paragraphs: [
						"Normal text with a block marker ^v420-block",
						"v420-field:: injected value",
					],
				},
				options,
			),
		).toBe("Normal text with a block marker \\^v420-block\n\nv420-field:\\: injected value");
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

describe("paragraph length", () => {
	const options = { episode, speakerTemplate: "", timestamp: timestampStyle("{{time}}") };
	const words = (count: number, from = 0) =>
		Array.from({ length: count }, (_, index) => `word${from + index}`).join(" ");

	test("a cue longer than the cap splits at word boundaries, each piece at the cue's time", () => {
		const long = words(2000);
		const paragraphs = renderTranscriptBody(
			{
				kind: "timed",
				cues: [
					{ start: 1, text: long },
					{ start: 2, text: "Next." },
				],
			},
			options,
		).split("\n\n");

		expect(paragraphs.length).toBeGreaterThan(2);
		for (const paragraph of paragraphs) {
			expect(paragraph.startsWith("00:00:01 word")).toBe(true);
			expect(paragraph.length - "00:00:01 ".length).toBeLessThanOrEqual(MAX_PARAGRAPH_LENGTH);
		}
		expect(paragraphs.map((paragraph) => paragraph.slice("00:00:01 ".length)).join(" ")).toBe(
			`${long} Next.`,
		);
	});

	test("a cue that would pass the cap starts the next paragraph at its own time", () => {
		const third = Math.floor(MAX_PARAGRAPH_LENGTH * 0.4);
		const cues: NonEmpty<TranscriptCue> = [
			{ start: 0, end: 1, speaker: "Eve", text: "a".repeat(third) },
			{ start: 1, end: 2, speaker: "Eve", text: "b".repeat(third) },
			{ start: 2, end: 3, speaker: "Eve", text: "c".repeat(third) },
		];

		expect(renderTranscriptBody({ kind: "timed", cues }, options)).toBe(
			`00:00:00 **Eve:** ${"a".repeat(third)} ${"b".repeat(third)}\n\n` +
				`00:00:02 **Eve:** ${"c".repeat(third)}`,
		);
	});

	test("the cap counts written characters, and a run without spaces splits between escapes", () => {
		const text = `a${"<".repeat(MAX_PARAGRAPH_LENGTH)}`;
		const paragraphs = renderTranscriptBody(
			{ kind: "untimed", paragraphs: [text] },
			options,
		).split("\n\n");

		expect(paragraphs).toHaveLength(3);
		for (const paragraph of paragraphs) {
			expect(paragraph.length).toBeLessThanOrEqual(MAX_PARAGRAPH_LENGTH);
			expect(paragraph).toMatch(/^a?(\\<)+$/);
		}
		expect(paragraphs.join("")).toBe(escapeTranscriptText(text));
	});

	test("a run without spaces never splits a character in two", () => {
		const text = `a${"😀".repeat(MAX_PARAGRAPH_LENGTH)}`;
		const paragraphs = renderTranscriptBody(
			{ kind: "untimed", paragraphs: [text] },
			options,
		).split("\n\n");

		expect(paragraphs.length).toBeGreaterThan(1);
		for (const paragraph of paragraphs) {
			expect(paragraph.length).toBeLessThanOrEqual(MAX_PARAGRAPH_LENGTH);
			expect(paragraph).not.toMatch(/[\uD800-\uDFFF]/u);
		}
		expect(paragraphs.join("")).toBe(text);
	});

	test("an untimed paragraph splits at word boundaries", () => {
		const long = words(1500);
		const paragraphs = renderTranscriptBody(
			{ kind: "untimed", paragraphs: [long, "Short."] },
			options,
		).split("\n\n");

		expect(paragraphs.length).toBeGreaterThan(2);
		expect(paragraphs.every((paragraph) => paragraph.length <= MAX_PARAGRAPH_LENGTH)).toBe(
			true,
		);
		expect(paragraphs.slice(0, -1).join(" ")).toBe(long);
		expect(paragraphs.at(-1)).toBe("Short.");
	});

	test("an untimed paragraph stays prose where it starts, also after a split", () => {
		const filler = "a".repeat(MAX_PARAGRAPH_LENGTH);
		const paragraphs: NonEmpty<string> = [
			"- item",
			"+ item",
			"* item",
			"> quote",
			"_ _ _",
			"---",
			"***",
			"1. item",
			"12) item",
			"1234567890. item",
			`${filler} - item`,
			"1990 was a year.",
			"**Host:** Welcome back.",
			"_So_ it begins.",
			"-1 degrees.",
		];

		expect(
			renderTranscriptBody({ kind: "untimed", paragraphs }, options).split("\n\n"),
		).toEqual([
			"\\- item",
			"\\+ item",
			"\\* item",
			"\\> quote",
			"\\_ _ _",
			"\\---",
			"\\***",
			"1\\. item",
			"12\\) item",
			"1234567890\\. item",
			filler,
			"\\- item",
			"1990 was a year.",
			"**Host:** Welcome back.",
			"_So_ it begins.",
			"-1 degrees.",
		]);
	});

	test("a speaker label keeps at most the speaker's first 100 written characters", () => {
		const speaker = `${"<".repeat(MAX_PARAGRAPH_LENGTH)} Eve`;

		expect(
			renderTranscriptBody(
				{ kind: "timed", cues: [{ start: 1, speaker, text: "Hi." }] },
				options,
			),
		).toBe(`00:00:01 **${"\\<".repeat(50)}:** Hi.`);
	});

	test("a long speaker on many paragraphs renders in linear time", () => {
		const speaker = "<".repeat(64_000);
		const cue = (index: number): TranscriptCue => ({ start: index * 10, speaker, text: "Hi." });
		const cues: NonEmpty<TranscriptCue> = [
			cue(0),
			...Array.from({ length: 1_999 }, (_, index) => cue(index + 1)),
		];

		const started = performance.now();
		const body = renderTranscriptBody({ kind: "timed", cues }, options);
		const elapsed = performance.now() - started;

		expect(body.split("\n\n")).toHaveLength(2_000);
		expect(elapsed).toBeLessThan(500);
	});
});

describe("timestampStyle", () => {
	test.each([
		["- {{linktime}} ", { format: "HH:mm:ss", linkify: true }],
		["{{LinkTime:mm:ss}}", { format: "mm:ss", linkify: true }],
		["{{linksegment}}", { format: "HH:mm:ss", linkify: true }],
		["{{time:H:mm}} {{linktime:mm:ss}}", { format: "H:mm", linkify: false }],
		["{{linktime:}}", { format: "HH:mm:ss", linkify: true }],
		["{{linktime: H:mm}}", { format: " H:mm", linkify: true }],
		["{{time: }}", { format: " ", linkify: false }],
		["{{linktime:\nmm:ss}}", { format: "\nmm:ss", linkify: true }],
		["> ", { format: "HH:mm:ss", linkify: false }],
		["{{ linktime }}", { format: "HH:mm:ss", linkify: false }],
		["{{ linktime:mm:ss }} {{time:H:mm}}", { format: "H:mm", linkify: false }],
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

	test("escapes table pipes", () => {
		expect(escapeTranscriptText("| a | b |\n|---|---|")).toBe(
			"\\| a \\| b \\| \\|---\\|---\\|",
		);
	});

	test("escapes every ^ and every colon after a colon, and keeps a single colon", () => {
		expect(escapeTranscriptText("a:: b a:::b at 10:30, 2^10")).toBe(
			"a:\\: b a:\\:\\:b at 10:30, 2\\^10",
		);
	});

	test("keeps prose punctuation readable and puts the text on one line", () => {
		expect(escapeTranscriptText("  It's 3.5 - well,\n\tnot *quite*.  ")).toBe(
			"It's 3.5 - well, not *quite*.",
		);
	});
});
