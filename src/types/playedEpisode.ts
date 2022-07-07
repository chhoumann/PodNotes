import { Episode } from "./Episode";

export interface PlayedEpisode extends Episode {
    time: number;
    duration: number;
}