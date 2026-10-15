export default function getUrlExtension(url: string): string {
	return /\.([0-9a-z]+)(?:[?#]|$)/i.exec(url)?.[1] ?? "";
}
