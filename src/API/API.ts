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
			throw new Error("No feed url");
		}

		const url = new URL(`obsidian://podnotes`);
		url.searchParams.set('time', `${this.currentTime}`);
		url.searchParams.set('url', this.podcast.feedUrl);
		url.searchParams.set('episodeName', this.podcast.title);

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
