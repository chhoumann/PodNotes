import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";

const nativeRequest = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => ({ requestUrl: nativeRequest }));

import {
	MAX_NETWORK_TIMEOUT_MS,
	NetworkError,
	type NetworkErrorCode,
	type NetworkRequestImplementation,
	type NetworkRequestOptions,
	type NetworkRequestParameters,
	TimeoutError,
	fetchJsonWithTimeout,
	fetchTextWithTimeout,
	requestWithTimeout,
} from "./networkRequest";

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

function makeResponse({
	status = 200,
	bytes = 0,
	text = "",
	json = {},
}: {
	status?: number;
	bytes?: number;
	text?: string;
	json?: unknown;
} = {}): RequestUrlResponse {
	return {
		status,
		headers: {},
		arrayBuffer: new Uint8Array(bytes).buffer,
		text,
		json,
	};
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function implementation(result: PromiseLike<RequestUrlResponse> = Promise.resolve(makeResponse())) {
	return vi.fn((_parameters: NetworkRequestParameters) => result);
}

function poisonedNetworkError(code: NetworkErrorCode, marker: string): NetworkError {
	const error = new NetworkError(code);
	Object.defineProperties(error, {
		message: { value: marker, enumerable: true },
		cause: { value: marker, enumerable: true },
		url: { value: `https://example.com/?token=${marker}`, enumerable: true },
	});
	return error;
}

async function rejectionOf(operation: Promise<unknown>): Promise<NetworkError> {
	try {
		await operation;
	} catch (error) {
		expect(error).toBeInstanceOf(NetworkError);
		return error as NetworkError;
	}
	throw new Error("Expected the network operation to reject.");
}

function expectRedactedError(
	error: NetworkError,
	code: NetworkErrorCode,
	markers: readonly string[] = [],
): void {
	expect(error.code).toBe(code);
	expect(error.message).toBe(
		code === "unexpected-status" && error.status !== undefined
			? `Network response returned HTTP ${error.status}.`
			: ERROR_MESSAGES[code],
	);
	expect(error).not.toHaveProperty("url");
	expect(error).not.toHaveProperty("cause");
	const exposed = `${String(error)} ${JSON.stringify(error)}`;
	for (const marker of markers) expect(exposed).not.toContain(marker);
}

beforeEach(() => {
	nativeRequest.mockReset();
	nativeRequest.mockResolvedValue(makeResponse());
});

afterEach(() => {
	vi.useRealTimers();
});

describe("requestWithTimeout target gate and forwarding", () => {
	it("validates the raw target before calling native transport and preserves URL compatibility", async () => {
		const body = "payload";

		await requestWithTimeout("https://EXAMPLE.com/a(b)?value=hello world", {
			method: "POST",
			contentType: "text/plain",
			headers: { "X-Test": "yes" },
			body,
		});

		expect(nativeRequest).toHaveBeenCalledTimes(1);
		expect(nativeRequest).toHaveBeenCalledWith({
			url: "https://example.com/a%28b%29?value=hello%20world",
			method: "POST",
			contentType: "text/plain",
			headers: { "X-Test": "yes" },
			body,
			throw: false,
		});
	});

	it("blocks an unsafe target before either native or injected transport", async () => {
		const request = implementation();
		const marker = "private-target-marker";
		const error = await rejectionOf(
			requestWithTimeout(`http://127.0.0.1/${marker}?token=${marker}`, { request }),
		);

		expectRedactedError(error, "unsafe-target", [marker, "127.0.0.1"]);
		expect(request).not.toHaveBeenCalled();
		expect(nativeRequest).not.toHaveBeenCalled();
	});

	it("rejects boundary whitespace instead of normalizing before policy", async () => {
		const request = implementation();
		const error = await rejectionOf(
			requestWithTimeout(" https://example.com/feed ", { request }),
		);

		expectRedactedError(error, "unsafe-target");
		expect(request).not.toHaveBeenCalled();
	});

	it("supports an injected request implementation without weakening policy", async () => {
		const request = implementation(Promise.resolve(makeResponse({ bytes: 2 })));

		const response = await requestWithTimeout("https://example.com/feed", { request });

		expect(response.arrayBuffer.byteLength).toBe(2);
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.com/feed", throw: false }),
		);
		expect(nativeRequest).not.toHaveBeenCalled();
	});
});

describe("requestWithTimeout option and body bounds", () => {
	it.each([
		{ timeoutMs: 0 },
		{ timeoutMs: 1.5 },
		{ timeoutMs: MAX_NETWORK_TIMEOUT_MS + 1 },
		{ maxRequestBodyBytes: -1 },
		{ maxRequestBodyBytes: 1.5 },
		{ maxResponseBytes: -1 },
		{ maxResponseBytes: Number.MAX_SAFE_INTEGER + 1 },
		{ acceptedStatuses: [] },
		{ acceptedStatuses: [99] },
		{ acceptedStatuses: [600] },
		{ signal: {} },
		{ request: {} },
	])("rejects invalid options before transport: %j", async (candidate) => {
		const error = await rejectionOf(
			requestWithTimeout(
				"https://example.com/feed",
				candidate as unknown as NetworkRequestOptions,
			),
		);

		expectRedactedError(error, "invalid-options");
		expect(nativeRequest).not.toHaveBeenCalled();
	});

	it("snapshots every option and signal member getter exactly once", async () => {
		const request = implementation();
		const signalGetters = {
			aborted: vi.fn(() => false),
			addEventListener: vi.fn(() => () => {}),
			removeEventListener: vi.fn(() => () => {}),
		};
		const signal = Object.create(null) as AbortSignal;
		for (const [name, getter] of Object.entries(signalGetters)) {
			Object.defineProperty(signal, name, { get: getter });
		}
		const statuses = [] as number[];
		const statusGetter = vi.fn(() => 200);
		Object.defineProperty(statuses, "0", { get: statusGetter, enumerable: true });
		const headers = Object.create(null) as Record<string, string>;
		const headerGetter = vi.fn(() => "yes");
		Object.defineProperty(headers, "X-Test", { get: headerGetter, enumerable: true });
		const values = {
			timeoutMs: 1_000,
			maxRequestBodyBytes: 4,
			maxResponseBytes: 8,
			acceptedStatuses: statuses,
			signal,
			method: "POST",
			contentType: "text/plain",
			headers,
			body: "body",
			request,
		};
		const options = Object.create(null) as NetworkRequestOptions;
		const optionGetters = Object.fromEntries(
			Object.entries(values).map(([name, value]) => {
				const getter = vi.fn(() => value);
				Object.defineProperty(options, name, { get: getter });
				return [name, getter];
			}),
		) as Record<string, ReturnType<typeof vi.fn>>;

		await expect(
			requestWithTimeout("https://example.com/feed", options),
		).resolves.toMatchObject({
			status: 200,
		});

		for (const getter of Object.values(optionGetters)) expect(getter).toHaveBeenCalledOnce();
		for (const getter of Object.values(signalGetters)) expect(getter).toHaveBeenCalledOnce();
		expect(statusGetter).toHaveBeenCalledOnce();
		expect(headerGetter).toHaveBeenCalledOnce();
		expect(request).toHaveBeenCalledOnce();
	});

	it("finishes deep option validation before starting transport", async () => {
		const marker = "status-option-secret-marker";
		const request = implementation();
		const statuses = [] as number[];
		Object.defineProperty(statuses, "0", {
			get() {
				throw new Error(marker);
			},
		});

		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				acceptedStatuses: statuses,
			}),
		);

		expectRedactedError(error, "invalid-options", [marker]);
		expect(request).not.toHaveBeenCalled();
		expect(nativeRequest).not.toHaveBeenCalled();
	});

	it("counts UTF-8 request bytes exactly and stops before transport when over the cap", async () => {
		const request = implementation();
		const oversized = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				body: "😀",
				maxRequestBodyBytes: 3,
			}),
		);

		expectRedactedError(oversized, "request-too-large");
		expect(request).not.toHaveBeenCalled();

		await expect(
			requestWithTimeout("https://example.com/feed", {
				request,
				body: "😀",
				maxRequestBodyBytes: 4,
			}),
		).resolves.toMatchObject({ status: 200 });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("bounds ArrayBuffer request bodies", async () => {
		const request = implementation();
		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				body: new Uint8Array(5).buffer,
				maxRequestBodyBytes: 4,
			}),
		);

		expectRedactedError(error, "request-too-large");
		expect(request).not.toHaveBeenCalled();
	});

	it("accepts genuine iframe-realm ArrayBuffers for request and response bodies", async () => {
		const iframe = document.createElement("iframe");
		document.body.append(iframe);
		const foreignWindow = iframe.contentWindow;
		if (!foreignWindow) throw new Error("Expected the iframe to have a window.");
		const foreignGlobal = foreignWindow as unknown as typeof globalThis;
		const requestBody = new foreignGlobal.ArrayBuffer(4);
		const responseBody = new foreignGlobal.ArrayBuffer(3);
		const request = implementation();

		try {
			const response = { ...makeResponse(), arrayBuffer: responseBody };
			request.mockReturnValueOnce(Promise.resolve(response));

			await expect(
				requestWithTimeout("https://example.com/feed", {
					request,
					body: requestBody,
					maxRequestBodyBytes: requestBody.byteLength,
					maxResponseBytes: responseBody.byteLength,
				}),
			).resolves.toMatchObject({ status: 200, arrayBuffer: responseBody });

			expect(requestBody).not.toBeInstanceOf(ArrayBuffer);
			expect(responseBody).not.toBeInstanceOf(ArrayBuffer);
			expect(request).toHaveBeenCalledWith(expect.objectContaining({ body: requestBody }));
		} finally {
			iframe.remove();
		}
	});

	it("rejects ArrayBuffer views and SharedArrayBuffers as bodies and responses", async () => {
		const invalidBuffers: readonly unknown[] = [new Uint8Array(4), new SharedArrayBuffer(4)];

		for (const invalidBuffer of invalidBuffers) {
			const bodyRequest = implementation();
			const bodyError = await rejectionOf(
				requestWithTimeout("https://example.com/feed", {
					request: bodyRequest,
					body: invalidBuffer as ArrayBuffer,
				}),
			);
			expectRedactedError(bodyError, "invalid-options");
			expect(bodyRequest).not.toHaveBeenCalled();

			const response = {
				...makeResponse(),
				arrayBuffer: invalidBuffer as ArrayBuffer,
			};
			const responseError = await rejectionOf(
				requestWithTimeout("https://example.com/feed", {
					request: implementation(Promise.resolve(response)),
				}),
			);
			expectRedactedError(responseError, "invalid-response");
		}
	});
});

describe("requestWithTimeout response policy", () => {
	it("projects binary responses without touching eager text or JSON getters", async () => {
		const marker = "unused-response-field-marker";
		const response = makeResponse({ bytes: 3 });
		const textGetter = vi.fn(() => {
			throw new Error(marker);
		});
		const jsonGetter = vi.fn(() => {
			throw new Error(marker);
		});
		Object.defineProperties(response, {
			text: { get: textGetter },
			json: { get: jsonGetter },
		});

		await expect(
			requestWithTimeout("https://example.com/feed", {
				request: implementation(Promise.resolve(response)),
			}),
		).resolves.toMatchObject({ status: 200, arrayBuffer: response.arrayBuffer });
		expect(textGetter).not.toHaveBeenCalled();
		expect(jsonGetter).not.toHaveBeenCalled();
	});

	it("returns the exact status and body snapshots that passed validation", async () => {
		const smallBody = new ArrayBuffer(2);
		const largeBody = new ArrayBuffer(20);
		const statusGetter = vi.fn().mockReturnValueOnce(200).mockReturnValue(500);
		const bodyGetter = vi.fn().mockReturnValueOnce(smallBody).mockReturnValue(largeBody);
		const response = makeResponse();
		Object.defineProperties(response, {
			status: { get: statusGetter },
			arrayBuffer: { get: bodyGetter },
		});

		const projected = await requestWithTimeout("https://example.com/feed", {
			request: implementation(Promise.resolve(response)),
			maxResponseBytes: 2,
		});

		expect(projected.status).toBe(200);
		expect(projected.arrayBuffer).toBe(smallBody);
		expect(statusGetter).toHaveBeenCalledOnce();
		expect(bodyGetter).toHaveBeenCalledOnce();
	});

	it("rejects a buffered response over the configured byte ceiling", async () => {
		const request = implementation(Promise.resolve(makeResponse({ bytes: 5 })));
		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				maxResponseBytes: 4,
			}),
		);

		expectRedactedError(error, "response-too-large");
	});

	it("accepts 2xx by default and rejects an exposed redirect", async () => {
		await expect(
			requestWithTimeout("https://example.com/feed", {
				request: implementation(Promise.resolve(makeResponse({ status: 206 }))),
			}),
		).resolves.toMatchObject({ status: 206 });

		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request: implementation(Promise.resolve(makeResponse({ status: 302 }))),
			}),
		);
		expectRedactedError(error, "unexpected-status");
		expect(error.status).toBe(302);
	});

	it("supports an explicit status allowlist for range and provider calls", async () => {
		const request = implementation(Promise.resolve(makeResponse({ status: 416 })));

		await expect(
			requestWithTimeout("https://example.com/media", {
				request,
				acceptedStatuses: [200, 206, 416],
			}),
		).resolves.toMatchObject({ status: 416 });
	});

	it("redacts the target and response body from a status failure", async () => {
		const marker = "status-secret-marker";
		const request = implementation(
			Promise.resolve(makeResponse({ status: 403, text: marker, json: { message: marker } })),
		);
		const error = await rejectionOf(
			requestWithTimeout(`https://user:pass@example.com/feed?token=${marker}`, { request }),
		);

		expectRedactedError(error, "unexpected-status", [marker, "user", "pass"]);
		expect(error.status).toBe(403);
	});

	it.each([
		null,
		{},
		{ status: Number.NaN, arrayBuffer: new ArrayBuffer(0) },
		{ status: 200, arrayBuffer: "not-bytes" },
	])("maps a malformed native response to a stable error: %j", async (value) => {
		const request = implementation(Promise.resolve(value as RequestUrlResponse));
		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", { request }),
		);

		expectRedactedError(error, "invalid-response");
	});
});

describe("requestWithTimeout timeout and cancellation", () => {
	it("settles promptly on timeout and observes a later native rejection", async () => {
		vi.useFakeTimers();
		const late = deferred<RequestUrlResponse>();
		const marker = "late-transport-marker";
		const operation = requestWithTimeout("https://example.com/feed", {
			request: implementation(late.promise),
			timeoutMs: 25,
		});
		const observed = rejectionOf(operation);

		await vi.advanceTimersByTimeAsync(25);
		const error = await observed;
		expect(error).toBeInstanceOf(TimeoutError);
		expectRedactedError(error, "timeout", [marker]);

		late.reject(new Error(marker));
		await Promise.resolve();
	});

	it("settles promptly on timeout and discards a later native response", async () => {
		vi.useFakeTimers();
		const late = deferred<RequestUrlResponse>();
		const operation = requestWithTimeout("https://example.com/feed", {
			request: implementation(late.promise),
			timeoutMs: 10,
		});
		const observed = rejectionOf(operation);

		await vi.advanceTimersByTimeAsync(10);
		expectRedactedError(await observed, "timeout");

		late.resolve(makeResponse({ text: "late" }));
		await Promise.resolve();
	});

	it("rejects an already-aborted signal before transport without exposing its reason", async () => {
		const controller = new AbortController();
		const marker = "pre-abort-marker";
		controller.abort(new Error(marker));
		const request = implementation();

		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				signal: controller.signal,
			}),
		);

		expectRedactedError(error, "aborted", [marker]);
		expect(request).not.toHaveBeenCalled();
	});

	it("maps hostile signal access and listener failures to stable errors", async () => {
		const marker = "signal-secret-marker";
		const request = implementation();
		const throwingGetter = {
			get aborted() {
				throw new Error(marker);
			},
			addEventListener: () => {},
			removeEventListener: () => {},
		} as unknown as AbortSignal;

		const getterError = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				signal: throwingGetter,
			}),
		);
		expectRedactedError(getterError, "invalid-options", [marker]);
		expect(request).not.toHaveBeenCalled();

		const throwingListener = {
			aborted: false,
			addEventListener() {
				throw new Error(marker);
			},
			removeEventListener() {
				throw new Error(marker);
			},
		} as unknown as AbortSignal;
		const listenerError = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				signal: throwingListener,
			}),
		);
		expectRedactedError(listenerError, "invalid-options", [marker]);
		expect(request).not.toHaveBeenCalled();
	});

	it("rejects an abort triggered by a later header getter before transport", async () => {
		const controller = new AbortController();
		const marker = "late-option-abort-marker";
		const request = implementation();
		const headers = Object.create(null) as Record<string, string>;
		Object.defineProperty(headers, "X-Test", {
			enumerable: true,
			get() {
				controller.abort(new Error(marker));
				return "yes";
			},
		});

		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				signal: controller.signal,
				headers,
			}),
		);

		expectRedactedError(error, "aborted", [marker]);
		expect(request).not.toHaveBeenCalled();
	});

	it("cleans up a shape-compatible signal that aborts during listener registration", async () => {
		vi.useFakeTimers();
		const late = deferred<RequestUrlResponse>();
		const request = implementation(late.promise);
		const listeners = new Set<EventListener>();
		const signal = {
			aborted: false,
			addEventListener(_type: string, listener: EventListener) {
				listeners.add(listener);
				listener(new Event("abort"));
			},
			removeEventListener(_type: string, listener: EventListener) {
				listeners.delete(listener);
			},
		} as unknown as AbortSignal;

		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				signal,
				timeoutMs: MAX_NETWORK_TIMEOUT_MS,
			}),
		);

		expectRedactedError(error, "aborted");
		expect(request).not.toHaveBeenCalled();
		expect(listeners).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
		late.resolve(makeResponse());
		await Promise.resolve();
	});

	it("settles on an in-flight abort and observes the late native rejection", async () => {
		const controller = new AbortController();
		const late = deferred<RequestUrlResponse>();
		const marker = "mid-abort-marker";
		const operation = requestWithTimeout("https://example.com/feed", {
			request: implementation(late.promise),
			signal: controller.signal,
		});
		const observed = rejectionOf(operation);

		controller.abort(new Error(marker));
		const error = await observed;
		expectRedactedError(error, "aborted", [marker]);

		late.reject(new Error(marker));
		await Promise.resolve();
	});

	it("closes the abort race between native start and listener registration", async () => {
		const controller = new AbortController();
		const late = deferred<RequestUrlResponse>();
		const request = vi.fn((_parameters: NetworkRequestParameters) => {
			controller.abort();
			return late.promise;
		});

		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request,
				signal: controller.signal,
			}),
		);

		expectRedactedError(error, "aborted");
		late.resolve(makeResponse());
		await Promise.resolve();
	});

	it("removes the abort listener and timeout after a successful response", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, "removeEventListener");

		await requestWithTimeout("https://example.com/feed", {
			request: implementation(),
			signal: controller.signal,
		});

		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("requestWithTimeout error redaction", () => {
	it("copies an option getter's NetworkError into a fresh stable error", async () => {
		const marker = "option-network-error-marker";
		const poisoned = poisonedNetworkError("invalid-options", marker);
		const options = Object.create(null) as NetworkRequestOptions;
		Object.defineProperty(options, "timeoutMs", {
			get() {
				throw poisoned;
			},
		});

		const error = await rejectionOf(requestWithTimeout("https://example.com/feed", options));

		expect(error).not.toBe(poisoned);
		expectRedactedError(error, "invalid-options", [marker]);
		expect(nativeRequest).not.toHaveBeenCalled();
	});

	it("does not inspect a hostile error thrown by an option getter", async () => {
		const marker = "changing-network-error-code-marker";
		const poisoned = poisonedNetworkError("invalid-options", marker);
		const codeGetter = vi.fn().mockReturnValueOnce("invalid-options").mockReturnValue(marker);
		Object.defineProperty(poisoned, "code", { get: codeGetter });
		const options = Object.create(null) as NetworkRequestOptions;
		Object.defineProperty(options, "timeoutMs", {
			get() {
				throw poisoned;
			},
		});

		const error = await rejectionOf(requestWithTimeout("https://example.com/feed", options));

		expect(codeGetter).not.toHaveBeenCalled();
		expect(error).not.toBe(poisoned);
		expectRedactedError(error, "invalid-options", [marker]);
		expect(nativeRequest).not.toHaveBeenCalled();
	});

	it("copies a response getter's NetworkError into a fresh stable error", async () => {
		const marker = "response-network-error-marker";
		const poisoned = poisonedNetworkError("unsafe-target", marker);
		const response = makeResponse();
		Object.defineProperty(response, "arrayBuffer", {
			get() {
				throw poisoned;
			},
		});

		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", {
				request: implementation(Promise.resolve(response)),
			}),
		);

		expect(error).not.toBe(poisoned);
		expectRedactedError(error, "invalid-response", [marker]);
	});

	it("copies a synchronous injected NetworkError into a fresh stable error", async () => {
		const marker = "transport-network-error-marker";
		const poisoned = poisonedNetworkError("transport-failure", marker);
		const request: NetworkRequestImplementation = () => {
			throw poisoned;
		};

		const error = await rejectionOf(
			requestWithTimeout("https://example.com/feed", { request }),
		);

		expect(error).not.toBe(poisoned);
		expectRedactedError(error, "transport-failure", [marker]);
	});

	it.each(["reject", "throw"])(
		"maps a native %s without exposing raw transport details",
		async (mode) => {
			const marker = "transport-secret-marker";
			const rawError = new Error(`native failed at https://example.com/?token=${marker}`);
			const request: NetworkRequestImplementation =
				mode === "reject"
					? () => Promise.reject(rawError)
					: () => {
							throw rawError;
						};

			const error = await rejectionOf(
				requestWithTimeout(`https://example.com/feed?token=${marker}`, { request }),
			);

			expectRedactedError(error, "transport-failure", [marker, "native failed"]);
		},
	);
});

describe("fetch compatibility helpers", () => {
	it("returns typed JSON and text through the same policy options", async () => {
		const value = { ok: true };
		const jsonRequest = implementation(
			Promise.resolve(makeResponse({ text: JSON.stringify(value) })),
		);
		const textRequest = implementation(Promise.resolve(makeResponse({ text: "hello" })));

		await expect(
			fetchJsonWithTimeout<typeof value>("https://example.com/data", {
				request: jsonRequest,
				acceptedStatuses: [200],
			}),
		).resolves.toEqual(value);
		await expect(
			fetchTextWithTimeout("https://example.com/data", {
				request: textRequest,
				maxResponseBytes: 1024,
			}),
		).resolves.toBe("hello");
	});

	it("parses stable text without touching the native JSON accessor", async () => {
		const marker = "json-secret-marker";
		const response = makeResponse({ text: '{"ok":true}' });
		const jsonGetter = vi.fn(() => {
			throw new Error(marker);
		});
		Object.defineProperty(response, "json", {
			get: jsonGetter,
		});
		await expect(
			fetchJsonWithTimeout("https://example.com/data", {
				request: implementation(Promise.resolve(response)),
			}),
		).resolves.toEqual({ ok: true });

		expect(jsonGetter).not.toHaveBeenCalled();
	});

	it.each([
		{ label: "ASCII", text: "abcd", maximumBytes: 3 },
		{ label: "multibyte", text: "😀", maximumBytes: 3 },
		{ label: "unpaired surrogate", text: "\ud800", maximumBytes: 2 },
	])(
		"rejects $label text whose UTF-8 bytes exceed the response limit",
		async ({ text, maximumBytes }) => {
			const error = await rejectionOf(
				fetchTextWithTimeout("https://example.com/data", {
					request: implementation(Promise.resolve(makeResponse({ text }))),
					maxResponseBytes: maximumBytes,
				}),
			);

			expectRedactedError(error, "response-too-large", [text]);
		},
	);

	it.each([
		{ label: "ASCII", text: "abcd", maximumBytes: 4 },
		{ label: "two-byte scalar", text: "é", maximumBytes: 2 },
		{ label: "surrogate pair", text: "😀", maximumBytes: 4 },
		{ label: "unpaired surrogate", text: "\ud800", maximumBytes: 3 },
	])("accepts $label text at the exact UTF-8 response limit", async ({ text, maximumBytes }) => {
		await expect(
			fetchTextWithTimeout("https://example.com/data", {
				request: implementation(Promise.resolve(makeResponse({ text }))),
				maxResponseBytes: maximumBytes,
			}),
		).resolves.toBe(text);
	});

	it("rejects a non-string text field as an invalid response", async () => {
		const response = { ...makeResponse(), text: 42 } as unknown as RequestUrlResponse;
		const error = await rejectionOf(
			fetchTextWithTimeout("https://example.com/data", {
				request: implementation(Promise.resolve(response)),
			}),
		);

		expectRedactedError(error, "invalid-response");
	});
});
