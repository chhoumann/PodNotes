const CONTENT_TYPE_EXTENSION_MAP: Array<{
	pattern: RegExp;
	extension: string;
}> = [
	{ pattern: /audio\/mpeg/i, extension: "mp3" },
	{ pattern: /audio\/mp3/i, extension: "mp3" },
	{ pattern: /audio\/mp4/i, extension: "m4a" },
	{ pattern: /audio\/x-m4a/i, extension: "m4a" },
	{ pattern: /audio\/aac/i, extension: "aac" },
	{ pattern: /audio\/ogg/i, extension: "ogg" },
	{ pattern: /audio\/wav/i, extension: "wav" },
	{ pattern: /audio\/x-wav/i, extension: "wav" },
	{ pattern: /audio\/flac/i, extension: "flac" },
	{ pattern: /audio\/x-flac/i, extension: "flac" },
	{ pattern: /audio\/x-ms-wma/i, extension: "wma" },
	{ pattern: /audio\/wma/i, extension: "wma" },
	{ pattern: /audio\/amr/i, extension: "amr" },
	{ pattern: /video\/mp4/i, extension: "mp4" },
	{ pattern: /video\/x-m4v/i, extension: "m4v" },
	{ pattern: /video\/quicktime/i, extension: "mov" },
	{ pattern: /video\/webm/i, extension: "webm" },
	{ pattern: /video\/ogg/i, extension: "ogv" },
];

export default function getExtensionFromContentType(
	contentType?: string | null,
): string | null {
	if (!contentType) {
		return null;
	}

	for (const { pattern, extension } of CONTENT_TYPE_EXTENSION_MAP) {
		if (pattern.test(contentType)) {
			return extension;
		}
	}

	return null;
}
