export default function addExtension(path: string, extension: string): string {
	const ext = extension.startsWith(".") ? extension : `.${extension}`;

	return path.endsWith(ext) ? path : `${path}${ext}`;
}
