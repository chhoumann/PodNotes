import { Episode } from "src/types/Episode";
import { formatSeconds } from "src/utility/formatSeconds";
import { IAPI } from "./IAPI";
import { currentEpisode, currentTime, duration, isPaused } from "src/store";
import { get } from "svelte/store";
import encodePodnotesURI from "src/utility/encodePodnotesURI";

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

	public set currentTime(value: number) {
		currentTime.update((_) => value);
	}
 
    public get isPlaying(): boolean {
		return !get(isPaused);
    }

    getPodcastTimeFormatted(format: string, linkify = false): string {
		if (!this.podcast) {
			throw new Error("No podcast loaded");
		}

		const time = formatSeconds(this.currentTime, format);
		
		if (!linkify) return time;

		if (!this.podcast.feedUrl) {
			// Considered handling this as an error case, but I think 
			// it's better UX to just show the time rather than getting an error.
			return time;
		}

		const url = encodePodnotesURI(
			this.podcast.title,
			this.podcast.feedUrl,
			this.currentTime
		);

		return `[${time}](${url.href})`;
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
