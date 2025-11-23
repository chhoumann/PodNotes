import type { Episode } from "./Episode";
import type { IconType } from "./IconType";

export type Playlist = {
	icon: IconType,
	name: string;
	episodes: Episode[];
	
	currentEpisode?: Episode;

	shouldEpisodeRemoveAfterPlay: boolean;
	shouldRepeat: boolean;
}
