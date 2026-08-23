export function toError(reason: unknown, fallbackMessage: string): Error {
	return reason instanceof Error ? reason : new Error(fallbackMessage);
}
