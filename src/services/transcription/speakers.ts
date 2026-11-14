import { type SameSpeaker, speakerKey, type TranscribedPart } from "./cues";
import type { PartTranscript, Word } from "./providers/types";
import { cutReel, type Span } from "./split";

/** A shorter turn makes a clip too short for a model to know the voice. */
const MIN_TURN_SECONDS = 2.6;
/** A clip leaves out this much at the ends of its turn, where word times are least sure. */
const CLIP_INSET_SECONDS = 0.2;
const MAX_CLIP_SECONDS = 9;

/** A speaker label's words in a row. Words without a label make turns of their own. */
type Turn = Span & { readonly speaker?: string };

function turnsOf(words: readonly Word[]): Turn[] {
	const turns: Turn[] = [];
	for (const { speaker, start, end } of words) {
		const last = turns[turns.length - 1];
		if (last && last.speaker === speaker) turns[turns.length - 1] = { ...last, end };
		else turns.push({ speaker, start, end });
	}
	return turns;
}

/**
 * The merge reel, one MP3 with a clip of each part's every voice from its longest turn, for
 * the model that labeled the parts to label again in one request. `match` reads that answer.
 * Part labels whose clips it gives one speaker are one person, and a label with no clip
 * stays its own. Undefined when fewer than two labels have a clip or the audio is not MP3.
 */
export function speakerReel(
	parts: readonly TranscribedPart[],
	audio: { readonly buffer: ArrayBuffer; readonly extension: string },
): { readonly file: File; match(answer: PartTranscript): SameSpeaker } | undefined {
	const voices = new Map<string, { talk: number; longest?: Span }>();
	parts.forEach(({ start, transcript }, part) => {
		if (!transcript || !("words" in transcript)) return;
		for (const turn of turnsOf(transcript.words)) {
			if (turn.speaker === undefined) continue;
			const key = speakerKey(part, turn.speaker);
			const voice = voices.get(key) ?? { talk: 0 };
			const seconds = turn.end - turn.start;
			voice.talk += seconds;
			if (
				seconds >= MIN_TURN_SECONDS &&
				(!voice.longest || seconds > voice.longest.end - voice.longest.start)
			) {
				voice.longest = { start: start + turn.start, end: start + turn.end };
			}
			voices.set(key, voice);
		}
	});
	// Most talk first, the order the reel was measured in.
	const clipped = [...voices]
		.flatMap(([key, { talk, longest }]) => (longest ? [{ key, talk, longest }] : []))
		.sort((a, b) => b.talk - a.talk);
	if (clipped.length < 2) return undefined;

	const reel = cutReel(
		audio,
		clipped.map(({ longest }) => ({
			start: longest.start + CLIP_INSET_SECONDS,
			end: Math.min(
				longest.end - CLIP_INSET_SECONDS,
				longest.start + CLIP_INSET_SECONDS + MAX_CLIP_SECONDS,
			),
		})),
	);
	if (!reel) return undefined;

	return {
		file: reel.file,
		match(answer) {
			const heard = "words" in answer ? turnsOf(answer.words) : [];
			const standsFor = new Map<string, string>();
			const same = new Map<string, string>();
			reel.clips.forEach((clip, index) => {
				const credit = new Map<string, number>();
				for (const { speaker, start, end } of heard) {
					const overlap = Math.min(end, clip.end) - Math.max(start, clip.start);
					if (speaker !== undefined && overlap > 0) {
						credit.set(speaker, (credit.get(speaker) ?? 0) + overlap);
					}
				}
				let speaker: string | undefined;
				let most = 0;
				for (const [label, seconds] of credit) {
					if (seconds > most) [speaker, most] = [label, seconds];
				}
				if (speaker === undefined) return;
				const { key } = clipped[index];
				const first = standsFor.get(speaker) ?? key;
				standsFor.set(speaker, first);
				same.set(key, first);
			});
			return same;
		},
	};
}
