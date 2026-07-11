import { requestUrl, type RequestUrlResponse } from "obsidian";
import { assertFetchableUrl } from "./assertFetchableUrl";

export const DEFAULT_NETWORK_TIMEOUT_MS = 30_000;
export const MAX_NETWORK_TIMEOUT_MS = 2_147_483_647;
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"byteLength",
)?.get;

export type NetworkErrorCode =
	| "invalid-options"
	| "unsafe-target"
	| "request-too-large"
	| "response-too-large"
	| "unexpected-status"
	| "timeout"
	| "aborted"
	| "transport-failure"
	| "invalid-response";

const ERROR_MESSAGES = {
	"invalid-options": "Network request options are invalid.",
	"unsafe-target": "Network request target is not allowed.",
	"request-too-large": "Network request body exceeds the configured limit.",
	"response-too-large": "Network response exceeds the configured limit.",
	"unexpected-status": "Network response status is not accepted.",
	timeout: "Network request timed out.",
	aborted: "Network request was aborted.",
	"transport-failure": "Network request failed.",
	"invalid-response": "Network response is invalid.",
} as const satisfies Record<NetworkErrorCode, string>;
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_MESSAGES));

export class NetworkError extends Error {
	public readonly status?: number;

	constructor(
		public readonly code: NetworkErrorCode,
		status?: number,
	) {
		const safeStatus =
			code === "unexpected-status" &&
			Number.isSafeInteger(status) &&
			status !== undefined &&
			status >= 100 &&
			status <= 599
				? status
				: undefined;
		super(
			safeStatus === undefined
				? ERROR_MESSAGES[code]
				: `Network response returned HTTP ${safeStatus}.`,
		);
		this.name = "NetworkError";
		this.status = safeStatus;
	}
}

export class TimeoutError extends NetworkError {
	constructor() {
		super("timeout");
		this.name = "TimeoutError";
	}
}

function copyRedactedNetworkError(error: unknown, fallbackCode: NetworkErrorCode): NetworkError {
	try {
		if (error instanceof NetworkError) {
			const code: unknown = error.code;
			if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) {
				const validatedCode = code as NetworkErrorCode;
				return validatedCode === "timeout"
					? new TimeoutError()
					: new NetworkError(validatedCode, error.status);
			}
		}
	} catch {
		// Hostile getters/proxies are replaced by the stable fallback below.
	}
	return new NetworkError(fallbackCode);
}

export interface NetworkRequestOptions {
	readonly timeoutMs?: number;
	readonly maxRequestBodyBytes?: number;
	readonly maxResponseBytes?: number;
	readonly acceptedStatuses?: readonly number[];
	readonly signal?: AbortSignal;
	readonly method?: string;
	readonly contentType?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string | ArrayBuffer;
	/** @internal Trusted test seam. Never populate from application or user input. */
	readonly request?: NetworkRequestImplementation;
}

export interface NetworkRequestParameters {
	readonly url: string;
	readonly method?: string;
	readonly contentType?: string;
	readonly headers?: Record<string, string>;
	readonly body?: string | ArrayBuffer;
	readonly throw: false;
}

export type NetworkRequestImplementation = (
	parameters: NetworkRequestParameters,
) => PromiseLike<RequestUrlResponse>;

interface PreparedNetworkRequestOptions {
	readonly timeoutMs: number;
	readonly maxRequestBodyBytes: number;
	readonly maxResponseBytes: number;
	readonly acceptedStatuses?: ReadonlySet<number>;
	readonly signal?: PreparedAbortSignal;
	readonly method?: string;
	readonly contentType?: string;
	readonly headers?: Record<string, string>;
	readonly body?: string | ArrayBuffer;
	readonly request: NetworkRequestImplementation;
}

interface NetworkRequestOptionsSnapshot {
	readonly timeoutMs: unknown;
	readonly maxRequestBodyBytes: unknown;
	readonly maxResponseBytes: unknown;
	readonly acceptedStatuses: unknown;
	readonly signal: unknown;
	readonly method: unknown;
	readonly contentType: unknown;
	readonly headers: unknown;
	readonly body: unknown;
	readonly request: unknown;
}

interface PreparedAbortSignal {
	readonly target: AbortSignal;
	readonly addEventListener: EventTarget["addEventListener"];
	readonly removeEventListener: EventTarget["removeEventListener"];
}

export interface NetworkBinaryResponse {
	readonly status: number;
	readonly headers: Record<string, string>;
	readonly arrayBuffer: ArrayBuffer;
}

interface NetworkTextResponse {
	readonly status: number;
	readonly arrayBuffer: ArrayBuffer;
	readonly text: string;
}

function invalidOptions(): NetworkError {
	return new NetworkError("invalid-options");
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function prepareAbortSignal(value: unknown): PreparedAbortSignal | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null) throw invalidOptions();

	try {
		const addEventListener: unknown = Reflect.get(value, "addEventListener");
		const removeEventListener: unknown = Reflect.get(value, "removeEventListener");
		if (typeof addEventListener !== "function" || typeof removeEventListener !== "function") {
			throw invalidOptions();
		}
		return {
			target: value as AbortSignal,
			addEventListener: addEventListener as EventTarget["addEventListener"],
			removeEventListener: removeEventListener as EventTarget["removeEventListener"],
		};
	} catch {
		throw invalidOptions();
	}
}

function readAbortState(signal: PreparedAbortSignal): boolean {
	try {
		const aborted: unknown = Reflect.get(signal.target, "aborted");
		if (typeof aborted !== "boolean") throw invalidOptions();
		return aborted;
	} catch {
		throw invalidOptions();
	}
}

function addAbortListener(signal: PreparedAbortSignal, listener: EventListener): void {
	try {
		Reflect.apply(signal.addEventListener, signal.target, ["abort", listener, { once: true }]);
	} catch {
		throw invalidOptions();
	}
}

function removeAbortListener(signal: PreparedAbortSignal, listener: EventListener): void {
	try {
		Reflect.apply(signal.removeEventListener, signal.target, ["abort", listener]);
	} catch {
		// Cleanup must never prevent the already-chosen result from settling.
	}
}

function arrayBufferByteLength(value: unknown): number | undefined {
	if (
		typeof value !== "object" ||
		value === null ||
		ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined
	) {
		return undefined;
	}
	try {
		const byteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []);
		return Number.isSafeInteger(byteLength) && byteLength >= 0 ? byteLength : undefined;
	} catch {
		// Reject views, SharedArrayBuffer, proxies, and objects spoofing toStringTag.
		return undefined;
	}
}

function copyHeaders(value: unknown): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw invalidOptions();
	}

	try {
		const headers = Object.create(null) as Record<string, string>;
		for (const [name, headerValue] of Object.entries(value)) {
			if (typeof headerValue !== "string") throw invalidOptions();
			headers[name] = headerValue;
		}
		return headers;
	} catch {
		throw invalidOptions();
	}
}

function snapshotOptions(value: unknown): NetworkRequestOptionsSnapshot {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw invalidOptions();
	}

	try {
		return {
			timeoutMs: Reflect.get(value, "timeoutMs"),
			maxRequestBodyBytes: Reflect.get(value, "maxRequestBodyBytes"),
			maxResponseBytes: Reflect.get(value, "maxResponseBytes"),
			acceptedStatuses: Reflect.get(value, "acceptedStatuses"),
			signal: Reflect.get(value, "signal"),
			method: Reflect.get(value, "method"),
			contentType: Reflect.get(value, "contentType"),
			headers: Reflect.get(value, "headers"),
			body: Reflect.get(value, "body"),
			request: Reflect.get(value, "request"),
		};
	} catch {
		throw invalidOptions();
	}
}

function copyAcceptedStatuses(value: unknown): ReadonlySet<number> | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw invalidOptions();

	try {
		const length: unknown = Reflect.get(value, "length");
		// There are exactly 500 valid HTTP status codes in the accepted domain.
		if (!Number.isSafeInteger(length) || (length as number) < 1 || (length as number) > 500) {
			throw invalidOptions();
		}

		const statuses = new Set<number>();
		for (let index = 0; index < (length as number); index += 1) {
			const status: unknown = Reflect.get(value, String(index));
			if (
				!Number.isSafeInteger(status) ||
				(status as number) < 100 ||
				(status as number) > 599
			) {
				throw invalidOptions();
			}
			statuses.add(status as number);
		}
		return statuses;
	} catch {
		throw invalidOptions();
	}
}

function prepareOptions(value: unknown): PreparedNetworkRequestOptions {
	try {
		const snapshot = snapshotOptions(value);
		const timeoutMs = snapshot.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;
		const maxRequestBodyBytes = snapshot.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
		const maxResponseBytes = snapshot.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

		if (
			typeof timeoutMs !== "number" ||
			!Number.isSafeInteger(timeoutMs) ||
			timeoutMs < 1 ||
			timeoutMs > MAX_NETWORK_TIMEOUT_MS ||
			!isNonNegativeSafeInteger(maxRequestBodyBytes) ||
			!isNonNegativeSafeInteger(maxResponseBytes)
		) {
			throw invalidOptions();
		}

		if (snapshot.method !== undefined && typeof snapshot.method !== "string") {
			throw invalidOptions();
		}
		if (snapshot.contentType !== undefined && typeof snapshot.contentType !== "string") {
			throw invalidOptions();
		}
		if (snapshot.request !== undefined && typeof snapshot.request !== "function") {
			throw invalidOptions();
		}

		const acceptedStatuses = copyAcceptedStatuses(snapshot.acceptedStatuses);
		const signal = prepareAbortSignal(snapshot.signal);
		const headers = copyHeaders(snapshot.headers);
		const body = validateRequestBody(snapshot.body, maxRequestBodyBytes);

		return {
			timeoutMs,
			maxRequestBodyBytes,
			maxResponseBytes,
			acceptedStatuses,
			signal,
			method: snapshot.method,
			contentType: snapshot.contentType,
			headers,
			body,
			request: (snapshot.request as NetworkRequestImplementation | undefined) ?? requestUrl,
		};
	} catch (error) {
		throw copyRedactedNetworkError(error, "invalid-options");
	}
}

function boundedUtf8ByteLength(value: string, maximumBytes: number): number | null {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		let added: number;
		if (code <= 0x7f) added = 1;
		else if (code <= 0x7ff) added = 2;
		else if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				added = 4;
				index += 1;
			} else added = 3;
		} else added = 3;

		if (added > maximumBytes - bytes) return null;
		bytes += added;
	}
	return bytes;
}

function validateRequestBody(
	value: unknown,
	maximumBytes: number,
): string | ArrayBuffer | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string") {
		if (boundedUtf8ByteLength(value, maximumBytes) === null) {
			throw new NetworkError("request-too-large");
		}
		return value;
	}

	const bufferBytes = arrayBufferByteLength(value);
	if (bufferBytes === undefined) throw invalidOptions();
	if (bufferBytes > maximumBytes) throw new NetworkError("request-too-large");
	return value as ArrayBuffer;
}

function assertTarget(rawUrl: string): string {
	try {
		const validated = assertFetchableUrl(rawUrl);
		return validated.href;
	} catch {
		throw new NetworkError("unsafe-target");
	}
}

function runNativeRequest(
	request: NetworkRequestImplementation,
	parameters: NetworkRequestParameters,
	timeoutMs: number,
	signal: PreparedAbortSignal | undefined,
): Promise<RequestUrlResponse> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timeoutId: number | undefined;
		let listenerRegistered = false;

		const cleanup = () => {
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
			if (signal && listenerRegistered) removeAbortListener(signal, onAbort);
		};
		const rejectOnce = (error: NetworkError) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const resolveOnce = (response: RequestUrlResponse) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(response);
		};
		const onAbort = () => rejectOnce(new NetworkError("aborted"));

		try {
			if (signal) {
				listenerRegistered = true;
				addAbortListener(signal, onAbort);
				if (readAbortState(signal)) onAbort();
			}
			if (settled) return;
			timeoutId = window.setTimeout(() => rejectOnce(new TimeoutError()), timeoutMs);
		} catch {
			rejectOnce(invalidOptions());
			return;
		}

		let pendingRequest: PromiseLike<RequestUrlResponse>;
		try {
			pendingRequest = request(parameters);
		} catch (error) {
			rejectOnce(copyRedactedNetworkError(error, "transport-failure"));
			return;
		}

		// requestUrl buffers natively and exposes no cancellation primitive. Always
		// attach both handlers so a response or rejection arriving after our logical
		// timeout/abort is observed instead of becoming an unhandled rejection.
		void Promise.resolve(pendingRequest).then(resolveOnce, () => {
			rejectOnce(new NetworkError("transport-failure"));
		});
	});
}

interface CommonResponseSnapshot {
	readonly status: number;
	readonly arrayBuffer: ArrayBuffer;
}

interface BinaryResponseFields {
	readonly status: unknown;
	readonly headers: unknown;
	readonly arrayBuffer: unknown;
}

interface TextResponseFields {
	readonly status: unknown;
	readonly arrayBuffer: unknown;
	readonly text: unknown;
}

function snapshotBinaryResponseFields(value: object): BinaryResponseFields {
	try {
		return {
			status: Reflect.get(value, "status"),
			headers: Reflect.get(value, "headers"),
			arrayBuffer: Reflect.get(value, "arrayBuffer"),
		};
	} catch {
		throw new NetworkError("invalid-response");
	}
}

function snapshotTextResponseFields(value: object): TextResponseFields {
	try {
		return {
			status: Reflect.get(value, "status"),
			arrayBuffer: Reflect.get(value, "arrayBuffer"),
			text: Reflect.get(value, "text"),
		};
	} catch {
		throw new NetworkError("invalid-response");
	}
}

function createCommonResponseSnapshot(
	status: unknown,
	arrayBuffer: unknown,
): CommonResponseSnapshot {
	if (!Number.isSafeInteger(status) || (status as number) < 100 || (status as number) > 599) {
		throw new NetworkError("invalid-response");
	}
	return { status: status as number, arrayBuffer: arrayBuffer as ArrayBuffer };
}

function copyResponseHeaders(value: unknown): Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new NetworkError("invalid-response");
	}

	try {
		const headers = Object.create(null) as Record<string, string>;
		for (const [name, headerValue] of Object.entries(value)) {
			if (typeof headerValue !== "string") {
				throw new NetworkError("invalid-response");
			}
			headers[name] = headerValue;
		}
		return Object.freeze(headers);
	} catch {
		throw new NetworkError("invalid-response");
	}
}

function validateCommonResponse(
	response: CommonResponseSnapshot,
	maximumBytes: number,
	acceptedStatuses: ReadonlySet<number> | undefined,
): void {
	const responseBytes = arrayBufferByteLength(response.arrayBuffer);
	if (responseBytes === undefined) throw new NetworkError("invalid-response");
	if (responseBytes > maximumBytes) throw new NetworkError("response-too-large");

	const accepted = acceptedStatuses
		? acceptedStatuses.has(response.status)
		: response.status >= 200 && response.status < 300;
	if (!accepted) throw new NetworkError("unexpected-status", response.status);
}

function validateBinaryResponse(
	value: unknown,
	maximumBytes: number,
	acceptedStatuses: ReadonlySet<number> | undefined,
): NetworkBinaryResponse {
	try {
		if (typeof value !== "object" || value === null) {
			throw new NetworkError("invalid-response");
		}
		const { status, headers, arrayBuffer } = snapshotBinaryResponseFields(value);
		const response = createCommonResponseSnapshot(status, arrayBuffer);
		const copiedHeaders = copyResponseHeaders(headers);
		validateCommonResponse(response, maximumBytes, acceptedStatuses);
		return Object.freeze({ ...response, headers: copiedHeaders });
	} catch (error) {
		throw copyRedactedNetworkError(error, "invalid-response");
	}
}

function validateTextResponse(
	value: unknown,
	maximumBytes: number,
	acceptedStatuses: ReadonlySet<number> | undefined,
): NetworkTextResponse {
	try {
		if (typeof value !== "object" || value === null) {
			throw new NetworkError("invalid-response");
		}
		const { status, arrayBuffer, text } = snapshotTextResponseFields(value);
		if (typeof text !== "string") throw new NetworkError("invalid-response");
		const response = createCommonResponseSnapshot(status, arrayBuffer);
		validateCommonResponse(response, maximumBytes, acceptedStatuses);
		if (boundedUtf8ByteLength(text, maximumBytes) === null) {
			throw new NetworkError("response-too-large");
		}
		return Object.freeze({ ...response, text });
	} catch (error) {
		throw copyRedactedNetworkError(error, "invalid-response");
	}
}

/**
 * Bounded, redacted boundary around Obsidian's CORS-free `requestUrl` transport.
 *
 * `requestUrl` does not expose redirect hops, the final URL, DNS answers, the
 * connected peer, native cancellation, or an incremental response stream. A
 * timeout or abort therefore settles only this logical operation: the native
 * request may finish later and its fully buffered response is observed and
 * discarded. The response byte ceiling is enforced immediately after that
 * native buffering completes, so it bounds consumers but cannot cap native
 * allocation while bytes are in flight.
 */
async function requestProjected<T>(
	url: string,
	options: NetworkRequestOptions,
	project: (
		value: unknown,
		maximumBytes: number,
		acceptedStatuses: ReadonlySet<number> | undefined,
	) => T,
): Promise<T> {
	const prepared = prepareOptions(options);
	const parameters: NetworkRequestParameters = {
		method: prepared.method,
		contentType: prepared.contentType,
		headers: prepared.headers,
		body: prepared.body,
		throw: false,
		// Keep the target gate as the final validation before listener registration.
		url: assertTarget(url),
	};
	const response = await runNativeRequest(
		prepared.request,
		parameters,
		prepared.timeoutMs,
		prepared.signal,
	);
	return project(response, prepared.maxResponseBytes, prepared.acceptedStatuses);
}

/** Fetch a stable binary response without touching eager text or JSON accessors. */
export async function requestWithTimeout(
	url: string,
	options: NetworkRequestOptions = {},
): Promise<NetworkBinaryResponse> {
	return requestProjected(url, options, validateBinaryResponse);
}

/** Fetch and decode JSON from the stable text projection. */
export async function fetchJsonWithTimeout<T>(
	url: string,
	options: NetworkRequestOptions = {},
): Promise<T> {
	const response = await requestProjected(url, options, validateTextResponse);
	try {
		return JSON.parse(response.text) as T;
	} catch {
		throw new NetworkError("invalid-response");
	}
}

/** Fetch text through the bounded request boundary. */
export async function fetchTextWithTimeout(
	url: string,
	options: NetworkRequestOptions = {},
): Promise<string> {
	return (await requestProjected(url, options, validateTextResponse)).text;
}
