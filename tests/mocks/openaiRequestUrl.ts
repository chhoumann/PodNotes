import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { vi } from "vitest";

/** OpenAI's side of Obsidian's requestUrl. Each test answers with a fetch Response. */
export const openAIMock = vi.fn<(request: RequestUrlParam) => Promise<Response>>();

/** Stands in for Obsidian's requestUrl and answers with `openAIMock`. */
export async function openAIRequestUrl(request: RequestUrlParam): Promise<RequestUrlResponse> {
	const response = await openAIMock(request);
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

/** The renderer's fetch as Obsidian runs it, where OpenAI's responses fail the CORS check. */
export const corsBlockedFetch = () => Promise.reject(new TypeError("Failed to fetch"));

/** The multipart form a request sent, parsed back by the platform. */
export function sentForm(request: RequestUrlParam): Promise<FormData> {
	return new Response(request.body, {
		headers: { "content-type": request.contentType ?? "" },
	}).formData();
}
