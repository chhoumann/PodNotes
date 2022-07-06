import { Episode } from "src/types/Episode";
import { formatSeconds } from "src/utility/formatSeconds";
import { IAPI } from "./IAPI";
import { currentEpisode, currentTime, duration, isPaused } from "src/store";
import { get } from "svelte/store";

export class API implements IAPI {
    public get podcast(): Episode {
		return get(currentEpisode);
    }

    public get length(): number {
		return get(duration);
    }

    public get currentTime(): number {
		return get(currentTime);
    }
 
    public get isPlaying(): boolean {
		return !get(isPaused);
    }

    getPodcastTimeFormatted(format: string): string {
        return formatSeconds(this.currentTime, format);
    }

    start(): void {
		isPaused.update((_) => false);
    }

    stop(): void {
		isPaused.update((_) => true);
    }

	clearPodcast(): void {
		//@ts-ignore
		currentEpisode.update((_) => null);
	}
}
