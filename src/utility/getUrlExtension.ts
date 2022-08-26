export default function getUrlExtension(url: string): string {
  	const extension = url.split(/[#?]/)[0]?.split('.').pop()?.trim();

	if (extension == undefined) {
		// Extraction failed
		return '';
	}

	return extension;
}
