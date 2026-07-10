import type { EpisodeHandle } from "src/security/resourceHandles";
import type { LibraryV3 } from "./model";
import { portableVaultPathOwnershipKey } from "./scalars";

export function libraryReferencesAreValid(model: LibraryV3): boolean {
	for (const episode of Object.values(model.episodes)) {
		if (!episode) continue;
		const feed = model.feeds[episode.feedId];
		if (!feed || feed.kind !== episode.kind) return false;
	}

	const episodeExists = (episodeId: EpisodeHandle): boolean => Boolean(model.episodes[episodeId]);
	if (model.currentEpisodeId && !episodeExists(model.currentEpisodeId)) return false;

	const allPlaylists = [
		model.queue,
		model.favorites,
		model.localFiles,
		...Object.values(model.playlists),
	];
	for (const playlist of allPlaylists) {
		if (playlist.episodeIds.some((episodeId) => !episodeExists(episodeId))) return false;
		if (playlist.currentEpisodeId && !episodeExists(playlist.currentEpisodeId)) return false;
	}
	if (
		model.localFiles.episodeIds.some((episodeId) => model.episodes[episodeId]?.kind !== "local")
	) {
		return false;
	}

	for (const [episodeId, progress] of Object.entries(model.progress)) {
		if (
			!progress ||
			progress.episodeId !== episodeId ||
			!model.episodes[episodeId as EpisodeHandle]
		)
			return false;
	}
	const claimedPaths = new Set<string>();
	const claimPath = (path: string): boolean => {
		const ownershipKey = portableVaultPathOwnershipKey(path);
		if (claimedPaths.has(ownershipKey)) return false;
		claimedPaths.add(ownershipKey);
		return true;
	};

	for (const [episodeId, note] of Object.entries(model.podNotes)) {
		if (!note || note.episodeId !== episodeId || !model.episodes[episodeId as EpisodeHandle]) {
			return false;
		}
		if (!claimPath(note.filePath)) return false;
	}

	for (const [episodeId, assets] of Object.entries(model.downloads)) {
		const episode = model.episodes[episodeId as EpisodeHandle];
		if (!episode || episode.kind !== "remote" || !assets) return false;
		for (const asset of assets) {
			if (!claimPath(asset.filePath)) return false;
		}
	}

	const localFileIds = new Set(model.localFiles.episodeIds);
	for (const [episodeId, asset] of Object.entries(model.localAssets)) {
		const episode = model.episodes[episodeId as EpisodeHandle];
		if (
			!asset ||
			asset.episodeId !== episodeId ||
			!episode ||
			episode.kind !== "local" ||
			!localFileIds.has(episodeId as EpisodeHandle)
		) {
			return false;
		}
		if (!claimPath(asset.filePath)) return false;
	}
	if (localFileIds.size !== Object.keys(model.localAssets).length) return false;

	for (const episode of Object.values(model.episodes)) {
		if (episode?.kind === "local" && !model.localAssets[episode.episodeId]) return false;
	}
	return true;
}
