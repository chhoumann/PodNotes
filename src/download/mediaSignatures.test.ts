import { describe, expect, it } from "vitest";
import { detectAudioFileExtension } from "./mediaSignatures";

function bytes(...values: number[]): ArrayBuffer {
	return new Uint8Array(values).buffer;
}

// Build a minimal ISO-BMFF header: a 4-byte box size, the 'ftyp' box type at
// offset 4, and the 4-character major brand at offset 8 (#DL-06).
function ftyp(brand: string): ArrayBuffer {
	const head = bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70);
	const brandBytes = new TextEncoder().encode(brand.padEnd(4, " ").slice(0, 4));
	const out = new Uint8Array(head.byteLength + brandBytes.byteLength);
	out.set(new Uint8Array(head), 0);
	out.set(brandBytes, head.byteLength);
	return out.buffer;
}

describe("detectAudioFileExtension", () => {
	it("matches exact signatures (ID3 -> mp3, RIFF -> wav)", () => {
		expect(detectAudioFileExtension(bytes(0x49, 0x44, 0x33, 0x04))).toBe("mp3");
		expect(detectAudioFileExtension(bytes(0x52, 0x49, 0x46, 0x46))).toBe("wav");
	});

	it("detects real ISO-BMFF m4a/mp4 by the ftyp major brand at offset 8 (#DL-06)", () => {
		// The major brand lives at offset 8, not offset 0 — the old offset-0 'M4A '
		// signature never matched a genuine m4a/mp4 file.
		expect(detectAudioFileExtension(ftyp("M4A "))).toBe("m4a");
		expect(detectAudioFileExtension(ftyp("M4B "))).toBe("mp4");
		expect(detectAudioFileExtension(ftyp("M4V "))).toBe("m4v");
		expect(detectAudioFileExtension(ftyp("qt  "))).toBe("mov");
		expect(detectAudioFileExtension(ftyp("mp42"))).toBe("mp4");
		expect(detectAudioFileExtension(ftyp("isom"))).toBe("mp4");
		// An unknown brand still resolves to a generic mp4 container.
		expect(detectAudioFileExtension(ftyp("zzzz"))).toBe("mp4");
	});

	it("does not treat a bare 'M4A ' (no ftyp box) as ISO-BMFF", () => {
		// Four bytes with no ftyp box type at offset 4 are not an MP4 file.
		expect(detectAudioFileExtension(bytes(0x4d, 0x34, 0x41, 0x20))).toBeNull();
	});

	it("applies the masked MPEG frame-sync signature", () => {
		expect(detectAudioFileExtension(bytes(0xff, 0xfb, 0x90, 0x00))).toBe("mp3");
	});

	it("returns null for unknown content", () => {
		expect(detectAudioFileExtension(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
	});

	it("does not crash on a buffer shorter than the longest signature", () => {
		expect(detectAudioFileExtension(bytes(0xff))).toBeNull();
		expect(detectAudioFileExtension(new ArrayBuffer(0))).toBeNull();
	});
});
