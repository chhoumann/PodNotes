import type { Vault } from "obsidian";

/**
 * Creates every missing folder along `folderPath`, one segment at a time.
 *
 * `Vault.createFolder` throws when the folder already exists, so each prefix is
 * guarded with `getAbstractFileByPath` before it is created. That guard is not
 * always enough: on a case-insensitive filesystem (default on macOS/Windows)
 * the lookup is case-sensitive while creation is not, and a concurrent create
 * can win the race — both make `createFolder` throw "Folder already exists" for
 * a folder that is genuinely present. Such a throw is swallowed (the folder we
 * wanted exists either way); any other error is rethrown. Fixes #87, where this
 * surfaced as a spurious "Failed to create note".
 *
 * `folderPath` is a directory path (no trailing file name). An empty path is a
 * no-op, so callers can pass the directory portion of a file path directly.
 *
 * `vault` defaults to the global `app.vault`; callers holding an injected vault
 * (e.g. a service given `plugin.app`) pass it so folder creation and the
 * subsequent file write target the same vault instance.
 */
export async function ensureFolderExists(
	folderPath: string,
	vault: Vault = app.vault,
): Promise<void> {
	const segments = folderPath.split("/").filter(Boolean);

	let current = "";
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		if (vault.getAbstractFileByPath(current)) {
			continue;
		}

		try {
			await vault.createFolder(current);
		} catch (error) {
			const alreadyExists =
				error instanceof Error && /already exists/i.test(error.message);
			// Re-check after a failed create: a case-insensitive filesystem or a
			// concurrent create can leave the folder present even though the
			// pre-check missed it. Only a genuine failure (still absent and not an
			// "already exists" error) is propagated.
			if (!alreadyExists && !vault.getAbstractFileByPath(current)) {
				throw error;
			}
		}
	}
}
