// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import FeedDocumentParser from "src/parser/feedDocumentParser";
import { transcriptFixture } from "../../../tests/mocks/transcriptFixtures";
import { choosePublishedTranscript } from "./index";
import { parseTranscript } from "./parse";

const buzzcast = transcriptFixture("buzzcast.html");

describe("parseTranscript HTML", () => {
	test("Buzzcast: each time starts a cue spoken by the cite before it", () => {
		expect(parseTranscript("html", buzzcast)).toEqual({
			kind: "timed",
			cues: [
				{
					start: 0,
					speaker: "Alban",
					text: "Moments ago, I just hit a professional milestone, a new accomplishment. All right, I'm gonna be using air quotes for this, but the first code that I ever wrote, and I'm now using air quotes for I wrote is now live in Buzzsprout as of like four minutes ago.",
				},
				{ start: 15, speaker: "Kevin", text: "Oh, your PR got accepted and merged?" },
				{ start: 17, speaker: "Alban", text: "It's merged." },
			],
		});
	});

	test("a turn's text is every p after its time, up to the next element that is not a p", () => {
		expect(
			parseTranscript(
				"html",
				"<cite>Alban</cite><time>0:00</time><p>One.</p><p>Two.</p>" +
					"<cite>Kevin</cite><time>0:05</time><p>Three.</p>",
			),
		).toEqual({
			kind: "timed",
			cues: [
				{ start: 0, speaker: "Alban", text: "One. Two." },
				{ start: 5, speaker: "Kevin", text: "Three." },
			],
		});
	});

	test("a page without times is untimed, one paragraph per p", () => {
		const untimed = buzzcast.replace(/<time>[^<]*<\/time>/g, "");

		expect(parseTranscript("html", untimed)).toEqual({
			kind: "untimed",
			paragraphs: [
				expect.stringMatching(/^Moments ago, .* four minutes ago\.$/),
				"Oh, your PR got accepted and merged?",
				"It's merged.",
			],
		});
	});

	test.each([
		"<html><body><div>Sign in</div></body></html>",
		"<body><div>First  part\nstill first\n\nSecond part</div></body>",
	])("a page without times or paragraphs cannot be read: %j", (html) => {
		expect(parseTranscript("html", html)).toBeUndefined();
	});
});

describe("cue markup in every timed format", () => {
	const said = "&lt;script&gt;alert(1)&lt;/script&gt; said <i>Eve</i>";

	test.each([
		[
			"vtt",
			`WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Eve>${said} <script src=x\n`,
			{
				start: 1,
				end: 2,
				speaker: "Eve",
				text: "<script>alert(1)</script> said Eve <script src=x",
			},
		],
		[
			"srt",
			`1\n00:00:01,000 --> 00:00:02,000\n${said} <script src=x\n`,
			{ start: 1, end: 2, text: "<script>alert(1)</script> said Eve <script src=x" },
		],
		[
			"html",
			`<cite>Eve</cite><time>0:01</time><p>${said}</p>`,
			{ start: 1, speaker: "Eve", text: "<script>alert(1)</script> said Eve" },
		],
	] as const)(
		"%s: tags are dropped, an unclosed one stays text, and entities decode once to text",
		(format, source, cue) => {
			expect(parseTranscript(format, source)).toEqual({ kind: "timed", cues: [cue] });
		},
	);
});

describe("choosePublishedTranscript on real feeds", () => {
	test.each([
		["build-your-saas.xml", "https://share.transistor.fm/s/9c22a01c/transcription.vtt", "vtt"],
		["buzzcast.xml", "https://www.buzzsprout.com/231452/19932962/transcript.vtt", "vtt"],
		["podcasting-2.0.xml", "https://mp3s.nashownotes.com/PC20-274-Captions.srt", "srt"],
	])("%s links its %s", (feed, reference, format) => {
		const [first] = new FeedDocumentParser().parseEpisodes(transcriptFixture(feed)).episodes;

		expect(choosePublishedTranscript("Show", first.transcripts)).toEqual({
			key: "Show",
			reference,
			format,
		});
	});
});
