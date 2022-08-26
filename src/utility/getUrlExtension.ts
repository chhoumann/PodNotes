export default function getUrlExtension(url: string): string {
	const regexp = new RegExp(/\.([0-9a-z]+)(?:[?#]|$)/i);
	const match = regexp.exec(url);

	if (!match) {
		return '';
	}

	const [, extension] = match;

	return extension;
}

