import { TFile } from "obsidian";

/**
 * Resolves a vault file path to a URL the webview's media element can play.
 *
 * Uses Obsidian's resource path (`app.vault.getResourcePath`) — the same mechanism
 * Obsidian uses for native `![[media]]` embeds. The native layer serves it with
 * byte-range support, which iOS requires: the WKWebView media stack loads audio
 * out-of-process and cannot read in-memory `blob:` URLs. The previous blob approach
 * worked on desktop (Electron/Chromium) but silently failed on iOS (issue #100).
 *
 * Returns an empty string when the path does not resolve to a vault file, matching
 * the prior behavior (binding `src=""` is a benign no-op on the audio element).
 */
export function createMediaUrlObjectFromFilePath(filePath: string): string {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!file || !(file instanceof TFile)) return "";

	return app.vault.getResourcePath(file);
}
