import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { vi } from "vitest";

/** The providers' side of Obsidian's requestUrl. Each test answers with a fetch Response. */
export const providerMock = vi.fn<(request: RequestUrlParam) => Promise<Response>>();

/** Stands in for Obsidian's requestUrl and answers with `providerMock`. */
export async function providerRequestUrl(request: RequestUrlParam): Promise<RequestUrlResponse> {
	const response = await providerMock(request);
	const arrayBuffer = await response.arrayBuffer();
	const text = new TextDecoder().decode(arrayBuffer);
	return {
		status: response.status,
		headers: Object.fromEntries(response.headers),
		arrayBuffer,
		text,
		get json() {
			return JSON.parse(text);
		},
	};
}

/** The renderer's fetch as Obsidian runs it, where a provider's responses fail the CORS check. */
export const corsBlockedFetch = () => Promise.reject(new TypeError("Failed to fetch"));

/** The multipart form a request sent, parsed back by the platform. */
export function sentForm(request: RequestUrlParam): Promise<FormData> {
	return new Response(request.body, {
		headers: { "content-type": request.contentType ?? "" },
	}).formData();
}

export function sentBytes(request: RequestUrlParam): Uint8Array {
	return typeof request.body === "string"
		? new TextEncoder().encode(request.body)
		: new Uint8Array(request.body ?? new ArrayBuffer(0));
}

/** Everything a provider can read in a request: its address, its headers and its body. */
export function sentText(request: RequestUrlParam): string {
	return [
		request.url,
		request.contentType,
		JSON.stringify(request.headers),
		new TextDecoder().decode(sentBytes(request)),
	].join("\n");
}
