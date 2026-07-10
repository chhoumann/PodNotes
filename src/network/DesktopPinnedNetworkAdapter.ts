/// <reference types="node" />

import type {
	NetworkNameResolver,
	PinnedNetworkHopAdapter,
	PinnedNetworkHopResponse,
} from "./PinnedNetworkHop";

interface DesktopNodeRequire {
	(moduleName: "node:dns"): typeof import("node:dns");
	(moduleName: "node:http"): typeof import("node:http");
	(moduleName: "node:https"): typeof import("node:https");
	(moduleName: "node:tls"): typeof import("node:tls");
}

declare const require: DesktopNodeRequire;

type ClientRequest = import("node:http").ClientRequest;
type IncomingMessage = import("node:http").IncomingMessage;
type Socket = import("node:net").Socket;

function abortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	const error = new Error("Network operation aborted");
	error.name = "AbortError";
	return error;
}

function rejected<T>(error: unknown): Promise<T> {
	return Promise.reject(error);
}

function resolveFamily(operation: () => Promise<readonly string[]>): Promise<readonly string[]> {
	try {
		return operation();
	} catch (error) {
		return rejected(error);
	}
}

function createNameResolver(dns: typeof import("node:dns")): NetworkNameResolver {
	return async (hostname, signal): Promise<readonly string[]> => {
		if (signal.aborted) throw abortError(signal);

		const resolver = new dns.promises.Resolver();
		const cancel = (): void => {
			try {
				resolver.cancel();
			} catch {
				// Cancellation remains best effort if the host resolver is already settled.
			}
		};
		signal.addEventListener("abort", cancel, { once: true });

		try {
			const ipv4 = resolveFamily(() => resolver.resolve4(hostname));
			const ipv6 = signal.aborted
				? rejected<readonly string[]>(abortError(signal))
				: resolveFamily(() => resolver.resolve6(hostname));
			const results = await Promise.allSettled([ipv4, ipv6]);
			if (signal.aborted) throw abortError(signal);

			const addresses = results.flatMap((result) =>
				result.status === "fulfilled" ? result.value : [],
			);
			if (addresses.length === 0) {
				const failure = results.find(
					(result): result is PromiseRejectedResult => result.status === "rejected",
				);
				throw failure?.reason ?? new Error("Network name resolution failed");
			}
			return Object.freeze(addresses);
		} finally {
			signal.removeEventListener("abort", cancel);
		}
	};
}

async function* responseBody(response: IncomingMessage): AsyncIterable<Uint8Array> {
	for await (const chunk of response) {
		if (typeof chunk === "string" || !ArrayBuffer.isView(chunk)) {
			throw new TypeError("Network response body was not binary");
		}
		yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	}
}

function createAdapter(
	http: typeof import("node:http"),
	https: typeof import("node:https"),
	tls: typeof import("node:tls"),
): PinnedNetworkHopAdapter {
	return (request): Promise<PinnedNetworkHopResponse> => {
		if (request.signal.aborted) return rejected(abortError(request.signal));

		return new Promise<PinnedNetworkHopResponse>((resolve, reject) => {
			let clientRequest: ClientRequest | undefined;
			let response: IncomingMessage | undefined;
			let socket: Socket | undefined;
			let adapterSettled = false;
			let closeStarted = false;
			let requestClosed = false;
			let responseClosed = false;
			let socketClosed = false;
			let closePromise: Promise<void> | undefined;
			let resolveClose: (() => void) | undefined;

			const resolveCloseIfComplete = (): void => {
				if (
					closeStarted &&
					(clientRequest === undefined || requestClosed) &&
					(response === undefined || responseClosed) &&
					(socket === undefined || socketClosed)
				) {
					resolveClose?.();
				}
			};

			const trackSocket = (nextSocket: Socket): void => {
				if (socket === nextSocket) return;
				socket = nextSocket;
				socketClosed = nextSocket.readyState === "closed";
				if (!socketClosed) {
					nextSocket.once("close", () => {
						socketClosed = true;
						resolveCloseIfComplete();
					});
				}
				resolveCloseIfComplete();
			};

			const beginClose = (error?: Error): Promise<void> => {
				if (closePromise) return closePromise;
				closeStarted = true;
				closePromise = new Promise<void>((resolvePromise) => {
					resolveClose = resolvePromise;
				});
				request.signal.removeEventListener("abort", onAbort);
				if (response && !response.destroyed) response.destroy(error);
				if (clientRequest && !clientRequest.destroyed) clientRequest.destroy(error);
				if (socket && !socket.destroyed) socket.destroy(error);
				resolveCloseIfComplete();
				return closePromise;
			};

			const rejectOnceAfterClose = (error: unknown, close: Promise<void>): void => {
				if (adapterSettled) return;
				adapterSettled = true;
				void close.then(() => reject(error));
			};

			function onAbort(): void {
				const error = abortError(request.signal);
				rejectOnceAfterClose(error, beginClose(error));
			}

			const onRequestError = (error: Error): void => {
				const close = beginClose(error);
				rejectOnceAfterClose(error, close);
			};

			const onResponse = (nextResponse: IncomingMessage): void => {
				response = nextResponse;
				trackSocket(response.socket);
				response.once("close", () => {
					responseClosed = true;
					resolveCloseIfComplete();
				});
				// The async iterator still observes the stored stream error. This listener
				// only prevents a socket reset racing ahead of iterator attachment.
				response.on("error", () => undefined);

				if (request.signal.aborted) {
					onAbort();
					return;
				}
				const status = response.statusCode;
				const connectedAddress = response.socket.remoteAddress;
				if (status === undefined || connectedAddress === undefined) {
					const error = new Error("Network response did not expose its connected peer");
					rejectOnceAfterClose(error, beginClose(error));
					return;
				}

				adapterSettled = true;
				resolve(
					Object.freeze({
						status,
						body: responseBody(response),
						connectedAddress,
						close: (): Promise<void> => beginClose(),
						...(response.headers.location === undefined
							? {}
							: { location: response.headers.location }),
					}),
				);
			};

			request.signal.addEventListener("abort", onAbort, { once: true });
			try {
				const baseOptions: import("node:http").RequestOptions = {
					hostname: request.connectAddress,
					port: request.port,
					path: request.requestTarget,
					method: request.method,
					headers: {
						Host: request.hostHeader,
						"Accept-Encoding": "identity",
					},
					setHost: false,
					agent: false,
					signal: request.signal,
				};
				clientRequest =
					request.protocol === "https:"
						? https.request({
								...baseOptions,
								rejectUnauthorized: true,
								...(request.serverName === undefined
									? {}
									: { servername: request.serverName }),
								checkServerIdentity: (_hostname, certificate) =>
									tls.checkServerIdentity(
										request.serverName ?? request.connectAddress,
										certificate,
									),
							})
						: http.request(baseOptions);
				clientRequest.once("response", onResponse);
				clientRequest.once("error", onRequestError);
				clientRequest.once("close", () => {
					requestClosed = true;
					resolveCloseIfComplete();
				});
				clientRequest.once("socket", trackSocket);
				if (clientRequest.socket) trackSocket(clientRequest.socket);
				if (request.signal.aborted) {
					onAbort();
					return;
				}
				clientRequest.end();
			} catch (error) {
				rejectOnceAfterClose(error, beginClose(error instanceof Error ? error : undefined));
			}
		});
	};
}

/**
 * Creates the Node-backed primitives for one desktop plugin generation.
 * Callers must gate this factory behind Obsidian's desktop platform check.
 */
export function createDesktopNetworkPrimitives(): Readonly<{
	nameResolver: NetworkNameResolver;
	adapter: PinnedNetworkHopAdapter;
}> {
	const dns = require("node:dns");
	const http = require("node:http");
	const https = require("node:https");
	const tls = require("node:tls");
	return Object.freeze({
		nameResolver: createNameResolver(dns),
		adapter: createAdapter(http, https, tls),
	});
}
