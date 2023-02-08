import { Episode } from "./Episode";

export interface LocalEpisode extends Episode {
    podcastName: "local file",
    description: "",
    content: ""
}