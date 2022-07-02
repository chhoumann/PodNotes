import { Podcast } from "src/types/podcast";
import { Parser } from "./parser";

export class PocketCastsParser extends Parser {
    protected parsePage(page: Document): Podcast {
        const audioPlayerEl = page.getElementById('audio_player');
        const titleEl = page.getElementsByTagName('h1');

        const title = titleEl[0].textContent;
        const streamUrl = audioPlayerEl?.getAttribute('src');

        if (!title || !streamUrl) {
            throw new Error("Unable to parse Pocket Cast podcast URL.");
        }

        return {title, streamUrl};
    }
}