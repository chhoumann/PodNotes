import { Player } from "src/Player";
import { PodcastView } from "src/ui/PodcastView";
import { Podcast } from "src/types/podcast";
import { formatSeconds } from "src/utility/formatSeconds";
import { IAPI } from "./IAPI";

export class API implements IAPI {
    constructor(private view: PodcastView) {}

    public get podcast(): Podcast {
        return this.view.podcast;
    }

    public get length(): number {
        return this.view.duration;
    }

    public get currentTime(): number {
        return this.view.currentTime;
    }
 
    public get isPlaying(): boolean {
        return Player.Instance.isPlaying;
    }

    getPodcastTimeFormatted(format: string): string {
        return formatSeconds(this.currentTime, format);
    }

    start(): void {
        Player.Instance.start();
    }

    stop(): void {
        Player.Instance.stop();
    }

	clearPodcast(): void {
		this.view.clearPodcast();
	}
}
