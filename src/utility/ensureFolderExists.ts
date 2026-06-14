/**
 * Creates every missing folder along `folderPath`, one segment at a time.
 *
 * `Vault.createFolder` throws when the folder already exists, so each prefix is
 * guarded with `getAbstractFileByPath` before it is created — mirroring the
 * loops already used in `createPodcastNote` and `TranscriptionService`.
 *
 * `folderPath` is a directory path (no trailing file name). An empty path is a
 * no-op, so callers can pass the directory portion of a file path directly.
 */
export async function ensureFolderExists(folderPath: string): Promise<void> {
	const segments = folderPath.split("/").filter(Boolean);

	let current = "";
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}
