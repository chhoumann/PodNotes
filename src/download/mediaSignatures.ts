// Binary magic-number / ISO-BMFF detection for downloaded media. Pure functions
// over the leading header bytes — no vault, network, or Obsidian dependency — so
// they're trivially unit-testable in isolation.

interface AudioSignature {
	signature: number[];
	mask?: number[];
	fileExtension: string;
}

/**
 * Map an ISO-BMFF (MP4/QuickTime) major brand to its file extension. Real m4a/mp4
 * files carry `ftyp` at offset 4 and the 4-byte major brand at offset 8 (not at
 * offset 0), so the old offset-0 `M4A ` signature never matched (#DL-06). Known
 * audio brands resolve to `m4a`; video brands to their own extension; everything
 * else defaults to `mp4` (or `m4a` when the caller hints the media is audio).
 */
function detectIsoBmffExtension(arr: Uint8Array): string | null {
	// Need 4 bytes of box size + 'ftyp' + the 4-byte major brand.
	if (arr.length < 12) return null;

	const isFtyp = arr[4] === 0x66 && arr[5] === 0x74 && arr[6] === 0x79 && arr[7] === 0x70;
	if (!isFtyp) return null;

	const brand = String.fromCharCode(arr[8], arr[9], arr[10], arr[11]);

	if (brand.startsWith("M4A")) return "m4a";
	if (brand.startsWith("M4V")) return "m4v";
	if (brand === "qt  ") return "mov";

	// `M4B `/`M4P ` are audiobook/protected-audio brands; the rest are generic
	// MP4 brands. All map to mp4 here — `inferFileExtensionFromDownload` /
	// `normalizeAudioExtension` re-map mp4 -> m4a when the media hint is audio.
	switch (brand) {
		case "mp42":
		case "isom":
		case "iso2":
		case "mp41":
		case "dash":
		case "M4B ":
		case "M4P ":
			return "mp4";
		default:
			return "mp4";
	}
}

export function detectAudioFileExtension(data: ArrayBuffer): string | null {
	const audioSignatures: AudioSignature[] = [
		{ signature: [0xff, 0xe0], mask: [0xff, 0xe0], fileExtension: "mp3" },
		{ signature: [0x49, 0x44, 0x33], fileExtension: "mp3" },
		{ signature: [0x52, 0x49, 0x46, 0x46], fileExtension: "wav" },
		{ signature: [0x4f, 0x67, 0x67, 0x53], fileExtension: "ogg" },
		{ signature: [0x66, 0x4c, 0x61, 0x43], fileExtension: "flac" },
		{
			signature: [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11],
			fileExtension: "wma",
		},
		{
			signature: [0x23, 0x21, 0x41, 0x4d, 0x52, 0x0a],
			fileExtension: "amr",
		},
	];

	// The ftyp brand lives at offset 8, past every offset-0 signature, so read a
	// header window long enough to cover both before zero-copy-viewing it.
	const maxSignatureLength = Math.max(12, ...audioSignatures.map((sig) => sig.signature.length));
	// Zero-copy view over just the header bytes — no Blob slice, no FileReader,
	// no extra full-file allocation.
	const arr = new Uint8Array(data, 0, Math.min(maxSignatureLength, data.byteLength));

	// ISO-BMFF is special-cased first: its brand sits at offset 8, so it can't be
	// expressed as an offset-0 signature like the entries above.
	const isoBmffExtension = detectIsoBmffExtension(arr);
	if (isoBmffExtension) {
		return isoBmffExtension;
	}

	for (const { signature, mask, fileExtension } of audioSignatures) {
		if (signature.length > arr.length) {
			continue;
		}

		let matches = true;
		for (let i = 0; i < signature.length; i++) {
			if (mask) {
				if ((arr[i] & mask[i]) !== (signature[i] & mask[i])) {
					matches = false;
					break;
				}
			} else {
				if (arr[i] !== signature[i]) {
					matches = false;
					break;
				}
			}
		}
		if (matches) {
			return fileExtension;
		}
	}

	return null;
}
