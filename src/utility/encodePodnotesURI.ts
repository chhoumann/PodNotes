export default function encodePodnotesURI(title: string, feedUrl: string, time?: number): URL {
	const url = new URL(`obsidian://podnotes`);

	const params = new URLSearchParams();
	params.set('episodeName', title);
	params.set('url', feedUrl);

	if (time !== undefined) {
		params.set('time', time.toString());
	}

	// Obsidian decodes protocol query values with decodeURIComponent only, which does NOT turn
	// '+' into a space. URLSearchParams serializes spaces as '+' and a literal '+' as '%2B', so
	// replacing '+' with '%20' yields plain percent-encoding that round-trips losslessly through
	// Obsidian's decoder — including titles or local-file paths that contain a literal '+'.
	url.search = params.toString().replace(/\+/g, '%20');

	return url;
}
