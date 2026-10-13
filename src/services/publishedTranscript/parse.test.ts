import { describe, expect, test } from "vitest";
import { transcriptFixture } from "../../../tests/mocks/transcriptFixtures";
import { parseTranscript, type ParsedTranscript, type TranscriptCue } from "./parse";

function cuesOf(parsed: ParsedTranscript | undefined): readonly TranscriptCue[] {
	if (parsed?.kind !== "timed")
		throw new Error(`Expected a timed transcript, got ${parsed?.kind}`);
	return parsed.cues;
}

const podnews = transcriptFixture("podnews-2026-10-05.vtt");

describe("parseTranscript", () => {
	test("Podnews VTT: leading spaces are trimmed and a raw & stays as written", () => {
		expect(cuesOf(parseTranscript("vtt", podnews)).slice(0, 3)).toEqual([
			{
				start: 0.48,
				end: 4.41,
				text: "From Potsdam in Brandenburg, Germany, the latest from podnews.net",
			},
			{ start: 4.41, end: 5.52, text: "with Soundstack." },
			{
				start: 7.1,
				end: 10.95,
				text: "The audio fiction podcast network Fable & Folly is to close at",
			},
		]);
	});

	test("a byte order mark before the JSON changes nothing", () => {
		const json = transcriptFixture("build-your-saas.json");

		expect(parseTranscript("json", `\uFEFF${json}`)).toEqual(parseTranscript("json", json));
	});

	test("entities in cue text are decoded once", () => {
		const encoded = podnews.replace(
			"Fable & Folly",
			"Fable &amp; Folly &lt;3 it&#39;s caf&#xe9; &amp;lt;",
		);

		expect(cuesOf(parseTranscript("vtt", encoded))[2].text).toBe(
			"The audio fiction podcast network Fable & Folly <3 it's caf\u00e9 &lt; is to close at",
		);
	});

	test.each([
		["vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n"],
		["srt", "1\n00:00:01,000 --> 00:00:02,000\n"],
	] as const)("%s: angle brackets that open no tag stay as written", (format, header) => {
		const cue = (text: string) => cuesOf(parseTranscript(format, `${header}${text}\n`))[0].text;

		expect(cue("a < b and c > d")).toBe("a < b and c > d");
		expect(cue("x <3 y")).toBe("x <3 y");
	});

	test.each([
		["unmatched <", `${"<".repeat(64_000)}word`],
		["unclosed voice tags", `${"<v ".repeat(64_000)}word`],
	])("a 64,000-character cue of %s stays text and parses in linear time", (_, text) => {
		const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${text}\n`;

		const started = performance.now();
		const parsed = parseTranscript("vtt", vtt);
		const elapsed = performance.now() - started;

		expect(cuesOf(parsed)).toEqual([{ start: 1, end: 2, text }]);
		expect(elapsed).toBeLessThan(200);
	});

	test("Build Your SaaS VTT: a voice names the speaker of the untagged cues after it", () => {
		const cues = cuesOf(parseTranscript("vtt", transcriptFixture("build-your-saas.vtt")));

		expect(cues.slice(0, 6).map((cue) => cue.speaker)).toEqual([
			"Justin",
			"Justin",
			"Michael",
			"Justin",
			"Justin",
			"Justin",
		]);
		expect(cues[1]).toEqual({
			start: 8.56,
			end: 10.16,
			speaker: "Justin",
			text: "What is going on here?",
		});
	});

	test("Build Your SaaS VTT: a 30 s cue stays one cue", () => {
		const cues = cuesOf(parseTranscript("vtt", transcriptFixture("build-your-saas.vtt")));

		expect(cues.find((cue) => cue.start === 206.3)).toEqual({
			start: 206.3,
			end: 236.99,
			speaker: "Michael",
			text: "I said no. I was looking for a new career at that point, which wouldn't move me to Prince Rupert. I took a web development bootcamp in 2022. Yeah, in my 30s, transitioned into tech. Then we met up locally at some local tech events, and this position sort of drew on my background in tech and customer service and things like that and sort of came together.",
		});
	});

	test("Build Your SaaS SRT: lines join, speaker prefixes stay text, and overlapping cues keep feed order", () => {
		const cues = cuesOf(parseTranscript("srt", transcriptFixture("build-your-saas.srt")));

		expect(cues).toHaveLength(12);
		expect(cues[0]).toEqual({
			start: 0,
			end: 2.32,
			text: "Justin: Michael, I can't do a podcast with you. I just",
		});
		expect(cues.slice(8, 10)).toEqual([
			{
				start: 36.47,
				end: 41.19,
				text: "chronicle the journey of building transistor.fm, a",
			},
			{
				start: 40.245,
				end: 44.405,
				text: "podcast hosting platform. I'm Justin Jackson, one of the co",
			},
		]);
	});

	test("Buzzcast SRT: spaces before the first index do not hide the first cue", () => {
		const cues = cuesOf(parseTranscript("srt", transcriptFixture("buzzcast.srt")));

		expect(cues).toHaveLength(8);
		expect(cues[0]).toEqual({
			start: 0.16,
			end: 3.759,
			text: "Alban: Moments ago, I just hit a professional milestone, a new",
		});
	});

	test("Adventures in DevOps SRT: CRLF line endings separate cues and lines", () => {
		const cues = cuesOf(parseTranscript("srt", transcriptFixture("adventures-in-devops.srt")));

		expect(cues).toHaveLength(6);
		expect(cues[1]).toEqual({
			start: 10.431,
			end: 17.276,
			text: "It's like the world suddenly woke up to realize that maybe testing is a necessity shocker, really.",
		});
	});

	test("Build Your SaaS JSON: string times become seconds", () => {
		const cues = cuesOf(parseTranscript("json", transcriptFixture("build-your-saas.json")));

		expect(cues).toHaveLength(6);
		expect(cues[1]).toEqual({
			start: 8.559999,
			end: 10.16,
			speaker: "Justin",
			text: "What is going on here?",
		});
	});

	test("Buzzcast JSON: word-level segments without the space-only ones", () => {
		const cues = cuesOf(parseTranscript("json", transcriptFixture("buzzcast.json")));

		expect(cues.slice(0, 3)).toEqual([
			{ start: 0.16, end: 0.64, speaker: "Alban", text: "Moments" },
			{ start: 0.64, end: 0.88, speaker: "Alban", text: "ago," },
			{ start: 1.04, end: 1.28, speaker: "Alban", text: "I" },
		]);
		expect(cues.some((cue) => cue.text.trim() === "")).toBe(false);
	});

	test("Build Your SaaS text: untimed paragraphs", () => {
		expect(parseTranscript("text", transcriptFixture("build-your-saas.txt"))).toEqual({
			kind: "untimed",
			paragraphs: [
				"Justin: Michael, I can't do a podcast with you. I just decided. It's done. We're done. I'll say, man, we got geese in the background.",
				"What is going on here?",
				"Michael: Oh gosh. It's my door. Sorry. One second. Sorry about the geese.",
				"Justin: God. Chris is gonna have a ball editing this one.",
				"Welcome to Build Your SaaS. This is the podcast where we chronicle the journey of building transistor.fm, a podcast hosting platform. I'm Justin Jackson, one of the co founders.",
			],
		});
	});

	test("text that opens with a cue in angle brackets is a transcript", () => {
		expect(parseTranscript("text", "<music> Welcome back.\n\nToday: feeds.")).toEqual({
			kind: "untimed",
			paragraphs: ["<music> Welcome back.", "Today: feeds."],
		});
	});

	test.each([
		["json", "<html>Not a transcript</html>"],
		["json", '{"version":"1.0.0"}'],
		["json", '{"segments":[{"startTime":"","body":"No start"},{"startTime":1,"body":" "}]}'],
		["vtt", "WEBVTT\n\nNOTE no cues here\n"],
		["srt", transcriptFixture("build-your-saas.txt")],
		["text", " \n\n\t\n"],
		["text", "<!DOCTYPE html>\n<html><body><p>Sign in</p></body></html>"],
		["text", "\n  <html><body>Sign in to read the transcript</body></html>"],
		["text", '<?xml version="1.0"?>\n<Error><Code>AccessDenied</Code></Error>'],
	] as const)("%s that cannot be read gives nothing: %j", (format, text) => {
		expect(parseTranscript(format, text)).toBeUndefined();
	});
});
