import { requestUrl } from "obsidian";
import type { Episode } from "src/types/Episode";

export abstract class Parser {
    url: string;

    constructor(url: string) {
        this.url = url;
    }

    public async parse() {
        const req = await requestUrl({url: this.url});
        const dp = new DOMParser();

        const body = dp.parseFromString(req.text, "text/html");
    
        return this.parsePage(body);
    }

    protected abstract parsePage(page: Document): Episode;
}
