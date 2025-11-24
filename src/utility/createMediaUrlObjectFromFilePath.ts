import { TFile } from "obsidian";

/**
 * Manages blob URLs to prevent memory leaks.
 * Tracks created URLs and provides cleanup mechanism.
 */
class BlobUrlManager {
	private activeUrls: Map<string, string> = new Map();

	/**
	 * Creates a blob URL for a file path, cleaning up any previous URL for the same path.
	 */
	async createUrl(filePath: string): Promise<string> {
		// Revoke existing URL for this file path to prevent memory leak
		this.revokeUrl(filePath);

		const file = app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return "";

		const binary = await app.vault.readBinary(file);
		const url = URL.createObjectURL(new Blob([binary], { type: "audio/mpeg" }));

		this.activeUrls.set(filePath, url);
		return url;
	}

	/**
	 * Revokes a blob URL for a specific file path.
	 */
	revokeUrl(filePath: string): void {
		const existingUrl = this.activeUrls.get(filePath);
		if (existingUrl) {
			URL.revokeObjectURL(existingUrl);
			this.activeUrls.delete(filePath);
		}
	}

	/**
	 * Revokes all active blob URLs. Call this on plugin unload.
	 */
	revokeAll(): void {
		for (const url of this.activeUrls.values()) {
			URL.revokeObjectURL(url);
		}
		this.activeUrls.clear();
	}

	/**
	 * Returns the number of active blob URLs (for debugging).
	 */
	get activeCount(): number {
		return this.activeUrls.size;
	}
}

// Singleton instance
export const blobUrlManager = new BlobUrlManager();

/**
 * Creates a blob URL from a file path in the vault.
 * Automatically cleans up previous URL for the same file.
 */
export async function createMediaUrlObjectFromFilePath(filePath: string): Promise<string> {
	return blobUrlManager.createUrl(filePath);
}
