/** Constant-bitrate Layer III streams with silent frames, so a test knows each frame's bytes and duration. */
export const MP3_STREAMS = {
	/** MPEG-1, 96 kbps, 48 kHz, mono: the issue #532 episode's format. */
	mpeg1At96Kbps: { header: [0xff, 0xfb, 0x74, 0xc4], frameBytes: 288, frameSeconds: 0.024 },
	/** MPEG-1, 320 kbps, 48 kHz, mono: 20 MiB holds under nine minutes. */
	mpeg1At320Kbps: { header: [0xff, 0xfb, 0xe4, 0xc4], frameBytes: 960, frameSeconds: 0.024 },
	/** MPEG-2.5, 8 kbps, 8 kHz, mono: an hour fits in 3.6 MB. */
	mpeg25At8Kbps: { header: [0xff, 0xe3, 0x18, 0xc0], frameBytes: 72, frameSeconds: 0.072 },
	/** The same, with a CRC and a padding byte in every frame. */
	mpeg25At8KbpsCrcPadded: {
		header: [0xff, 0xe2, 0x1a, 0xc0],
		frameBytes: 73,
		frameSeconds: 0.072,
	},
} as const;

export type Mp3Stream = (typeof MP3_STREAMS)[keyof typeof MP3_STREAMS];

export function mp3Bytes(stream: Mp3Stream, frames: number): Uint8Array {
	const bytes = new Uint8Array(frames * stream.frameBytes);
	for (let frame = 0; frame < frames; frame++)
		bytes.set(stream.header, frame * stream.frameBytes);
	return bytes;
}

/**
 * `frames` frames of `stream` whose last three bytes hold the voice `voiceOf` gives the
 * frame (0 for none) and the frame's index, so a test can hear who speaks in a request and
 * tell which of the episode's frames it holds.
 */
export function voicedMp3Bytes(
	stream: Mp3Stream,
	frames: number,
	voiceOf: (frame: number) => number,
): Uint8Array {
	const bytes = mp3Bytes(stream, frames);
	for (let frame = 0; frame < frames; frame++) {
		bytes.set([voiceOf(frame), frame >> 8, frame & 0xff], (frame + 1) * stream.frameBytes - 3);
	}
	return bytes;
}

/** The seconds of audio in `bytes` of `stream`, counted from its fixed frame size. */
export function mp3Seconds(stream: Mp3Stream, bytes: number): number {
	return (bytes / stream.frameBytes) * stream.frameSeconds;
}
