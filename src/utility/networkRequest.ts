import { requestUrl, type RequestUrlResponse } from "obsidian";

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

export class NetworkError extends Error {
	constructor(
		message: string,
		public readonly url: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "NetworkError";
	}
}

export class TimeoutError extends NetworkError {
	constructor(url: string, timeoutMs: number) {
		super(`Request timed out after ${timeoutMs}ms`, url);
		this.name = "TimeoutError";
	}
}

/**
 * Makes a network request with timeout protection.
 * Throws TimeoutError if the request takes longer than the specified timeout.
 * Throws NetworkError for other network-related failures.
 */
export async function requestWithTimeout(
	url: string,
	options: {
		timeoutMs?: number;
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	} = {},
): Promise<RequestUrlResponse> {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, method, headers, body } = options;

	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new TimeoutError(url, timeoutMs));
		}, timeoutMs);
	});

	try {
		const response = await Promise.race([
			requestUrl({
				url,
				method,
				headers,
				body,
				throw: false, // Don't throw on non-2xx status
			}),
			timeoutPromise,
		]);

		// Check for HTTP errors
		if (response.status >= 400) {
			throw new NetworkError(
				`HTTP ${response.status}: ${response.text?.slice(0, 100) || "Unknown error"}`,
				url,
			);
		}

		return response;
	} catch (error) {
		if (error instanceof NetworkError) {
			throw error;
		}
		throw new NetworkError(
			error instanceof Error ? error.message : String(error),
			url,
			error,
		);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

/**
 * Fetches JSON from a URL with timeout protection.
 */
export async function fetchJsonWithTimeout<T>(
	url: string,
	options: { timeoutMs?: number } = {},
): Promise<T> {
	const response = await requestWithTimeout(url, options);
	return response.json as T;
}

/**
 * Fetches text from a URL with timeout protection.
 */
export async function fetchTextWithTimeout(
	url: string,
	options: { timeoutMs?: number } = {},
): Promise<string> {
	const response = await requestWithTimeout(url, options);
	return response.text;
}
