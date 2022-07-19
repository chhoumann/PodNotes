import { Episode } from "./Episode";
import { IconType } from "./IconType";

export type Playlist = {
	icon: IconType,
	name: string;
	episodes: Episode[];
	
	currentEpisode?: Episode;

	shouldEpisodeRemoveAfterPlay: boolean;
	shouldRepeat: boolean;
}
