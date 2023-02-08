import { LocalEpisode } from "src/types/LocalEpisode";
import { Episode } from "src/types/Episode";

export function isLocalFile(ep: Episode): ep is LocalEpisode {
    return ep.podcastName === "local file";
}