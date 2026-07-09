import { TFile, type Vault } from "obsidian";

/**
 * Resolves a vault file path to a URL the webview's media element can play.
 *
 * Uses Obsidian's resource path (`Vault.getResourcePath`) — the same mechanism
 * Obsidian uses for native `![[media]]` embeds. The native layer serves it with
 * byte-range support, which iOS requires: the WKWebView media stack loads audio
 * out-of-process and cannot read in-memory `blob:` URLs. The previous blob approach
 * worked on desktop (Electron/Chromium) but silently failed on iOS (issue #100).
 *
 * The `vault` is passed in (from the plugin's app reference) rather than read off
 * the global `app`, so the helper stays decoupled and the caller controls which
 * vault instance is used.
 *
 * Returns an empty string when the path does not resolve to a vault file, matching
 * the prior behavior (binding `src=""` is a benign no-op on the audio element).
 */
export function createMediaUrlObjectFromFilePath(vault: Vault, filePath: string): string {
	const file = vault.getAbstractFileByPath(filePath);
	if (!file || !(file instanceof TFile)) return "";

	return vault.getResourcePath(file);
}
