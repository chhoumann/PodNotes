export default function getUrlExtension(url: string): string {
	const extension = url.split('.').pop()?.split(/[#?]/).pop();

	if (extension?.contains(url)) {
		// Extraction failed
		return "";
	}

	return extension ?? "";
}
