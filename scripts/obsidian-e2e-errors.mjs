/**
 * @param {unknown} error
 * @returns {error is { code: unknown }}
 */
function hasErrorCode(error) {
	return typeof error === "object" && error !== null && "code" in error;
}

/**
 * @param {unknown} error
 * @param {string} code
 */
export function errorHasCode(error, code) {
	return hasErrorCode(error) && error.code === code;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract the useful output attached to a rejected child-process command.
 *
 * @param {unknown} error
 */
export function commandErrorMessage(error) {
	if (typeof error === "object" && error !== null) {
		if ("stderr" in error && typeof error.stderr === "string" && error.stderr.trim()) {
			return error.stderr.trim();
		}
		if ("stdout" in error && typeof error.stdout === "string" && error.stdout.trim()) {
			return error.stdout.trim();
		}
	}
	return error instanceof Error ? error.message : String(error);
}
