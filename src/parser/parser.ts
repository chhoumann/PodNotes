import { requestUrl } from "obsidian";
import { Podcast } from "src/types/podcast";

export abstract class Parser {
    url: string;
    private parsed: any;

    constructor(url: string) {
        this.url = url;
    }

    public async parse() {
        const req = await requestUrl({url: this.url});
        const dp = new DOMParser();

        const body = dp.parseFromString(req.text, "text/html");
    
        return this.parsePage(body);
    }

    protected abstract parsePage(page: Document): Podcast;
}