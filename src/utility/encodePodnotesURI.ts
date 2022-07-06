export default function encodePodnotesURI(title: string, feedUrl: string, time?: number): URL {
	const url = new URL(`obsidian://podnotes`);
	
	url.searchParams.set('episodeName', title);
	url.searchParams.set('url', feedUrl);

	if (time) {
		url.searchParams.set('time', time.toString());
	}

	return url;
}
