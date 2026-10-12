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

	test("a page without times or paragraphs is its text split on blank lines", () => {
		expect(
			parseTranscript(
				"html",
				"<body><div>First  part\nstill first\n\nSecond part</div></body>",
			),
		).toEqual({ kind: "untimed", paragraphs: ["First part still first", "Second part"] });
	});
});

describe("choosePublishedTranscript on real feeds", () => {
	test.each([
		["build-your-saas.xml", "https://share.transistor.fm/s/9c22a01c/transcription.vtt", "vtt"],
		["buzzcast.xml", "https://www.buzzsprout.com/231452/19932962/transcript.vtt", "vtt"],
		["podcasting-2.0.xml", "https://mp3s.nashownotes.com/PC20-274-Captions.srt", "srt"],
	])("%s links its %s", (feed, link, format) => {
		const [first] = new FeedDocumentParser().parseEpisodes(transcriptFixture(feed)).episodes;

		expect(choosePublishedTranscript("Show", first.transcripts)).toEqual({
			key: "Show",
			link,
			format,
		});
	});
});
