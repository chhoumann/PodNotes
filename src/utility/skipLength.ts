// Default used when a persisted/configured skip length is missing or invalid
// (e.g. a cleared settings field serialized to null/NaN). Mirrors
// DEFAULT_SETTINGS.skip*Length.
const DEFAULT_SKIP_LENGTH = 15;

export const normalizeSkipLength = (length: number): number =>
	Number.isFinite(length) && length > 0 ? length : DEFAULT_SKIP_LENGTH;
