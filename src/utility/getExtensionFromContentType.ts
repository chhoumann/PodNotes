const CONTENT_TYPE_EXTENSIONS: ReadonlyArray<readonly [pattern: RegExp, extension: string]> = [
	[/audio\/mpeg/i, "mp3"],
	[/audio\/mp3/i, "mp3"],
	[/audio\/mp4/i, "m4a"],
	[/audio\/x-m4a/i, "m4a"],
	[/audio\/aac/i, "aac"],
	[/audio\/ogg/i, "ogg"],
	[/audio\/wav/i, "wav"],
	[/audio\/x-wav/i, "wav"],
	[/audio\/flac/i, "flac"],
	[/audio\/x-flac/i, "flac"],
	[/audio\/x-ms-wma/i, "wma"],
	[/audio\/wma/i, "wma"],
	[/audio\/amr/i, "amr"],
	[/audio\/webm/i, "webm"],
	[/video\/mp4/i, "mp4"],
	[/video\/x-m4v/i, "m4v"],
	[/video\/quicktime/i, "mov"],
	[/video\/webm/i, "webm"],
	[/video\/ogg/i, "ogv"],
];

export default function getExtensionFromContentType(contentType?: string | null): string | null {
	if (!contentType) {
		return null;
	}

	return CONTENT_TYPE_EXTENSIONS.find(([pattern]) => pattern.test(contentType))?.[1] ?? null;
}
