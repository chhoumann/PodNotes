import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { createPrivateKey } from "node:crypto";
import type { AddressInfo } from "node:net";
import * as tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopNetworkPrimitives } from "./DesktopPinnedNetworkAdapter";
import type { PinnedNetworkHopRequest, PinnedNetworkHopResponse } from "./PinnedNetworkHop";

const TEST_CA = `-----BEGIN CERTIFICATE-----
MIIDKTCCAhGgAwIBAgIUKKe57BMvUfGX6MPCr/K2P0a+b+MwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQUG9kTm90ZXMgVGVzdCBDQTAgFw0yNjA3MTAxNzM0Mzda
GA8yMTI2MDYxNjE3MzQzN1owGzEZMBcGA1UEAwwQUG9kTm90ZXMgVGVzdCBDQTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALMd/tbDLftm7RXSGd7Yu1PJ
DxqLmIljG5LqGrNzLIQh3S6n5uKFS7gr4Zu5FQ32bhnDV3WnpmSh4Z3rZuQIpzqL
pG0XAs5z8b0JlCS3obDJHxs/oCz5AD4bOMI9lnRhHhJFBXt3fetNBAFAlvJOA1HQ
tAHG6qSTowwDkJgjmziEMTW9iBeVAaWKWv0IQVTY+eZTn19YnTgot5hC1xWqqYKQ
19bYsi0jMygSGjPb985X2+IAh1xTX61cz3/XkwjynPi31EyqzSez/URj5/7MEaD9
oXnqbcCoBymfuk6rwtz+nCUMrwg/JTqSCdwi6D9s4RA9sZrA7PhoEbaaAlbtSL8C
AwEAAaNjMGEwHQYDVR0OBBYEFIqSoqO3BzSWe5SqwEoMwJi8C36IMB8GA1UdIwQY
MBaAFIqSoqO3BzSWe5SqwEoMwJi8C36IMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0P
AQH/BAQDAgEGMA0GCSqGSIb3DQEBCwUAA4IBAQA8pqx5pIoxsnsdxZysYHueiRay
rgEdqiQWGw6Z0eE1V/n3WfjbyqIn6X1EmJJDBq+uDIR6PkxIRQIIKgv5lRm6gJag
xW7SfyvhXubkI3XNoV4vZiNeD/WIxcS5nhDfoKKBLhPFfbK8XPg+4Uja6YBPSc6/
E9I1x+p5agi+stww0by3LAnNU1zp+5SnsBKH3SbZHiEGUQBJ3o1m66GSXSdgJoKD
pQpHYts3+B/97ngTw6/XJiKyGrb0TLgOU932XhfYwEFCh0vufH50ZwSiqnwboLLv
VeArqAy5qsTPLfXNdiv0LqVv9xKh9c3/oSYEJy1IMYvwbDohADKzPGUO8HxM
-----END CERTIFICATE-----`;

const TEST_SERVER_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDMjCCAhqgAwIBAgIUek61i/3a9on1lgYcLwM0q6fAFUowDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQUG9kTm90ZXMgVGVzdCBDQTAgFw0yNjA3MTAxNzM0Mzda
GA8yMTI2MDYxNjE3MzQzN1owFDESMBAGA1UEAwwJZmVlZC50ZXN0MIIBIjANBgkq
hkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3XbKBj4EdfNcU+7DeUwVEQwfH+w75WCX
IFS1tPwSYQ/EAJJ2/v6e9nU3LUkt+QOY6njME2mb32iOY4f7dx9QX5KDXy75YI+X
MvZBStjxhb/4IqrEmSEEnZgHrVGeZMefMjBQti0KE43iYgKHWijLjQY/gYVIE4/y
rY/CJ/tuZqZF2N8beaAX2v96B6T38ncYKIuZjbW36TNaNrngKyLY0WOMrAOCiWg8
GKS4NMTZxQa85I/PhJ/X8xWHlEglYU+LpyP3MMzu5NtezcXyqHGhVCAEvjPzAEk0
RGcZAmlRYPvYEaQUmiNk1hHBepB4ngbV8/PQ7aMmQj3ju/GxAmssFQIDAQABo3Mw
cTAaBgNVHREEEzARgglmZWVkLnRlc3SHBH8AAAEwEwYDVR0lBAwwCgYIKwYBBQUH
AwEwHQYDVR0OBBYEFD6IZ2QOGItQtzIiddYCDP8Rqrp4MB8GA1UdIwQYMBaAFIqS
oqO3BzSWe5SqwEoMwJi8C36IMA0GCSqGSIb3DQEBCwUAA4IBAQBmExcnER58mIdv
auqR6l8wigDDkzX9chDS2MzHNcGMVu1V4q8dln1BauA8lCq7wzxdExxmxYU9xRxb
nEeho8EvDTY95TpFODpb5077PLt22lxBioEGiZ6k2yyeBAva7EPlXNJ5NUa/dntb
Kh2q5/7Ql9gD2W1EQpUeEZ2rci6+Fw+wxrD5ImKTkIeB01QwlirSjFmMzeH4hhjI
sdyC56GC6wifgion1wEnIBnTKxkglzQRX8CIO6ki6UDEk9v8US6rTb+iWjxnrpfd
oP2MlZPfrzkK3rX0XZKK9tddF+PoZzr2zKmmSpLnH2k7bmENgRJ2NivJiIJJeaDN
e/pCawaX
-----END CERTIFICATE-----`;

const TEST_SERVER_PRIVATE_KEY_DER = `MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDddsoGPgR181xT
7sN5TBURDB8f7DvlYJcgVLW0/BJhD8QAknb+/p72dTctSS35A5jqeMwTaZvfaI5j
h/t3H1BfkoNfLvlgj5cy9kFK2PGFv/giqsSZIQSdmAetUZ5kx58yMFC2LQoTjeJi
AodaKMuNBj+BhUgTj/Ktj8In+25mpkXY3xt5oBfa/3oHpPfydxgoi5mNtbfpM1o2
ueArItjRY4ysA4KJaDwYpLg0xNnFBrzkj8+En9fzFYeUSCVhT4unI/cwzO7k217N
xfKocaFUIAS+M/MASTREZxkCaVFg+9gRpBSaI2TWEcF6kHieBtXz89DtoyZCPeO7
8bECaywVAgMBAAECggEAKl27a6LJFSxjVP4n4Gg83nhAawm08p4+AvYZlcAkHvPW
ZdqfD4xzqgfF8LCfbhPxWKeXuL37DuvQU3uT0FfJ9yKO5bJVjBKkFOB1oKUsXQ8a
n70l43pkyOYoz8/9ml9y1bXW9ubaVt/NdzzvGkEUIYwYsYUnAvEGdov6E05+8f1R
L0KobPlF0admCQv0oCUtrllvmbAJ7DnW36iHhEQVxmafr74ksbpqc8zsdkFeavpJ
Kecw40RgHZ8DfBLhwiEK7hRgRrTN0D8x//BhzcQLQN58Dl61nF+YQM5yyz2mVM65
HZfaLr8GD5wl41ASNjMoBrrKDgk5DE8PEsuRfRvUiQKBgQD+0kOY7PVxBtH8MdYX
DX9fQNspTd6f6AEyiQhuqrEEsemFGRYKH44GAjNPk7dLFefHWrWGPkUQgqfyMv1z
H6OAmf+356G500wRdhJups/mbYeCIt4r/1U+ZB3/BQn+Bvj6PJK+JTuDeYyS4CFm
8oySVlhk1aHtOVjqTzwgbp0MnQKBgQDefQbEmP7nw2I0bz993/GGBRsQLgrFuwKL
s6W1gG6u53v88DNfG0hIOcVKUszOAHtjfePYvui0azajdl34ZrTL8tSTGtDPslmm
n2FFxqd2XZvoCWoVqBb4u1FSwuXuqRk7b/u+cwseFINQUOphOPBmTMbNUWmjtsWC
xE9CTqD32QKBgQCKzhhaTgFonxF1MeRvzD9ssJRxTGSPcD5uu6xnM/2XFB6jDMYv
n36qkTpIB6vZb8ZAlo244WSXmMRJLzNWKY7Tt49PKxKyeYG/JTTnJ2CqIVGmNr4U
81II2VppluIZiMzI6oP4palkdap4OzSWslqWQAiIbMJ2yT1A7QZQmFBeFQKBgQDG
AhOB6IAEF/lQnSmuhx3WnrilP7TKoVL0rh9uVy0qcE4CoGu32voLfY6+RM6NEBTA
SQv8nHtSBpEMDY44Qn/peuYBPb5U+m+bQQE7Lj9fspPMgIRvXbeECoGn3FjyfIA+
S72Kk6xzSuJLGphdimU5Rl8v36La1xEU/k1jv8K2kQKBgGXU8s3Rdpxubboi+clL
XCFKWxYggoOEyQv2/z6RApinWr4UM5mfQoyKUtqILp5MPr1OdlQLNVop+HkRQmZ4
56MDDIqNQXCcYJfCglHgN8WoaH8F2Y27t1H9nDdstP4pz/JabTM/kcOybSK2hIO2
KFI5c+f3rpDcC3yZ9ugfxkcf`;

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function listen(server: http.Server | https.Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	return (server.address() as AddressInfo).port;
}

async function closeServer(server: http.Server | https.Server): Promise<void> {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function within<T>(promise: PromiseLike<T>, milliseconds = 2_000): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			Promise.resolve(promise),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("Operation did not settle promptly")),
					milliseconds,
				);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

function requestFor(
	port: number,
	signal: AbortSignal,
	overrides: Partial<PinnedNetworkHopRequest> = {},
): PinnedNetworkHopRequest {
	return Object.freeze({
		protocol: "http:",
		connectAddress: "127.0.0.1",
		port,
		hostHeader: `feed.test:${port}`,
		requestTarget: "/feed.xml",
		method: "GET",
		credentials: "omit",
		redirect: "manual",
		signal,
		...overrides,
	});
}

async function bodyText(response: PinnedNetworkHopResponse): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of response.body) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createDesktopNetworkPrimitives name resolver", () => {
	it("returns a frozen aggregate and snapshots IPv4 and IPv6 answers", async () => {
		const prototype = dns.promises.Resolver.prototype;
		vi.spyOn(prototype, "resolve4").mockResolvedValue(["93.184.216.34"]);
		vi.spyOn(prototype, "resolve6").mockResolvedValue(["2001:4860:4860::8888"]);
		const primitives = createDesktopNetworkPrimitives();

		const addresses = await primitives.nameResolver("feed.test", new AbortController().signal);

		expect(addresses).toEqual(["93.184.216.34", "2001:4860:4860::8888"]);
		expect(Object.isFrozen(addresses)).toBe(true);
		expect(Object.isFrozen(primitives)).toBe(true);
	});

	it("keeps a successful address family when the other family has no answer", async () => {
		const prototype = dns.promises.Resolver.prototype;
		vi.spyOn(prototype, "resolve4").mockResolvedValue(["93.184.216.34"]);
		vi.spyOn(prototype, "resolve6").mockRejectedValue(
			Object.assign(new Error("no IPv6 answer"), { code: "ENODATA" }),
		);
		const { nameResolver } = createDesktopNetworkPrimitives();

		await expect(nameResolver("feed.test", new AbortController().signal)).resolves.toEqual([
			"93.184.216.34",
		]);
	});

	it("synchronously cancels both in-flight address-family queries on abort", async () => {
		const ipv4 = deferred<string[]>();
		const ipv6 = deferred<string[]>();
		const prototype = dns.promises.Resolver.prototype;
		vi.spyOn(prototype, "resolve4").mockImplementation(() => ipv4.promise);
		vi.spyOn(prototype, "resolve6").mockImplementation(() => ipv6.promise);
		const cancel = vi.spyOn(prototype, "cancel").mockImplementation(() => {
			const error = Object.assign(new Error("cancelled"), { code: "ECANCELLED" });
			ipv4.reject(error);
			ipv6.reject(error);
		});
		const { nameResolver } = createDesktopNetworkPrimitives();
		const controller = new AbortController();
		const reason = new Error("caller cancelled");
		const pending = Promise.resolve(nameResolver("feed.test", controller.signal));

		controller.abort(reason);

		expect(cancel).toHaveBeenCalledTimes(1);
		await expect(within(pending)).rejects.toBe(reason);
	});

	it("does not start DNS work for an already-aborted operation", async () => {
		const prototype = dns.promises.Resolver.prototype;
		const resolve4 = vi.spyOn(prototype, "resolve4");
		const resolve6 = vi.spyOn(prototype, "resolve6");
		const { nameResolver } = createDesktopNetworkPrimitives();
		const controller = new AbortController();
		const reason = new Error("already cancelled");
		controller.abort(reason);

		await expect(nameResolver("feed.test", controller.signal)).rejects.toBe(reason);
		expect(resolve4).not.toHaveBeenCalled();
		expect(resolve6).not.toHaveBeenCalled();
	});
});

describe("createDesktopNetworkPrimitives HTTP adapter", () => {
	it("connects to the selected address and preserves Host, path, redirect, and credentials policy", async () => {
		const observed = deferred<{
			method?: string;
			url?: string;
			host?: string;
			acceptEncoding?: string;
			authorization?: string;
			cookie?: string;
		}>();
		let requestCount = 0;
		const server = http.createServer((request, response) => {
			requestCount += 1;
			observed.resolve({
				method: request.method,
				url: request.url,
				host: request.headers.host,
				acceptEncoding: request.headers["accept-encoding"],
				authorization: request.headers.authorization,
				cookie: request.headers.cookie,
			});
			response.writeHead(302, { Location: "/redirected" });
			response.end("redirect body");
		});
		const port = await listen(server);

		try {
			const { adapter } = createDesktopNetworkPrimitives();
			const response = await adapter(
				requestFor(port, new AbortController().signal, {
					hostHeader: "feeds.example.test:8443",
					requestTarget: "/audio%2fpart?sig=TOP-SECRET%2BVALUE",
				}),
			);

			expect(await observed.promise).toEqual({
				method: "GET",
				url: "/audio%2fpart?sig=TOP-SECRET%2BVALUE",
				host: "feeds.example.test:8443",
				acceptEncoding: "identity",
				authorization: undefined,
				cookie: undefined,
			});
			expect(response.status).toBe(302);
			expect(response.location).toBe("/redirected");
			expect(response.connectedAddress).toBe("127.0.0.1");
			expect(await bodyText(response)).toBe("redirect body");
			expect(requestCount).toBe(1);
			expect(Object.isFrozen(response)).toBe(true);
			await response.close();
		} finally {
			await closeServer(server);
		}
	});

	it("rejects promptly and closes the socket when aborted before response headers", async () => {
		const requestSeen = deferred<void>();
		const socketClosed = deferred<void>();
		const server = http.createServer((request) => {
			requestSeen.resolve();
			request.socket.once("close", () => socketClosed.resolve());
		});
		const port = await listen(server);

		try {
			const { adapter } = createDesktopNetworkPrimitives();
			const controller = new AbortController();
			const reason = new Error("stop before headers");
			const pending = Promise.resolve(adapter(requestFor(port, controller.signal)));
			await within(requestSeen.promise);

			controller.abort(reason);

			await expect(within(pending)).rejects.toBe(reason);
			await within(socketClosed.promise);
		} finally {
			await closeServer(server);
		}
	});

	it("settles pending body iteration and closes once when aborted mid-response", async () => {
		const socketClosed = deferred<void>();
		let closeEvents = 0;
		const server = http.createServer((request, response) => {
			request.socket.once("close", () => {
				closeEvents += 1;
				socketClosed.resolve();
			});
			response.on("error", () => undefined);
			response.writeHead(200);
			response.write("first chunk");
		});
		const port = await listen(server);

		try {
			const { adapter } = createDesktopNetworkPrimitives();
			const controller = new AbortController();
			const response = await adapter(requestFor(port, controller.signal));
			const iterator = response.body[Symbol.asyncIterator]();
			const first = await within(iterator.next());
			expect(Buffer.from(first.value ?? []).toString("utf8")).toBe("first chunk");
			const pendingBody = iterator.next();
			const reason = new Error("stop body");

			controller.abort(reason);

			await expect(within(pendingBody)).rejects.toBe(reason);
			const firstClose = response.close();
			const secondClose = response.close();
			expect(firstClose).toBe(secondClose);
			await within(Promise.resolve(firstClose));
			await within(socketClosed.promise);
			expect(closeEvents).toBe(1);
		} finally {
			await closeServer(server);
		}
	});

	it("rejects an abrupt peer close before headers", async () => {
		const server = http.createServer();
		server.on("connection", (socket) => socket.destroy());
		const port = await listen(server);

		try {
			const { adapter } = createDesktopNetworkPrimitives();
			await expect(
				within(Promise.resolve(adapter(requestFor(port, new AbortController().signal)))),
			).rejects.toBeInstanceOf(Error);
		} finally {
			await closeServer(server);
		}
	});
});

describe.skipIf(typeof tls.setDefaultCACertificates !== "function")(
	"createDesktopNetworkPrimitives HTTPS adapter",
	() => {
		it("uses normal CA validation and verifies DNS SNI or the literal IP SAN", async () => {
			const hosts: Array<string | undefined> = [];
			const server = https.createServer(
				{
					key: createPrivateKey({
						key: Buffer.from(
							TEST_SERVER_PRIVATE_KEY_DER.replaceAll("\n", ""),
							"base64",
						),
						format: "der",
						type: "pkcs8",
					}).export({ format: "pem", type: "pkcs8" }),
					cert: TEST_SERVER_CERTIFICATE,
				},
				(request, response) => {
					hosts.push(request.headers.host);
					response.end("secure");
				},
			);
			server.on("tlsClientError", () => undefined);
			const port = await listen(server);
			const originalCertificates = tls.getCACertificates("default");

			try {
				const { adapter } = createDesktopNetworkPrimitives();
				await expect(
					adapter(
						requestFor(port, new AbortController().signal, {
							protocol: "https:",
							serverName: "feed.test",
						}),
					),
				).rejects.toBeInstanceOf(Error);

				tls.setDefaultCACertificates([...originalCertificates, TEST_CA]);
				const namedResponse = await adapter(
					requestFor(port, new AbortController().signal, {
						protocol: "https:",
						serverName: "feed.test",
					}),
				);
				expect(await bodyText(namedResponse)).toBe("secure");
				await namedResponse.close();

				const literalResponse = await adapter(
					requestFor(port, new AbortController().signal, {
						protocol: "https:",
						hostHeader: `127.0.0.1:${port}`,
					}),
				);
				expect(await bodyText(literalResponse)).toBe("secure");
				await literalResponse.close();

				await expect(
					adapter(
						requestFor(port, new AbortController().signal, {
							protocol: "https:",
							serverName: "wrong.test",
						}),
					),
				).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
				expect(hosts).toEqual([`feed.test:${port}`, `127.0.0.1:${port}`]);
			} finally {
				tls.setDefaultCACertificates(originalCertificates);
				await closeServer(server);
			}
		});
	},
);
