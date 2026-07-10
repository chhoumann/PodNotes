import {
	isResolvedAddressLiteral,
	resolvedAddressesEqual,
	type NetworkProtocol,
	type TargetPolicyView,
} from "./LiteralTargetClassifier";
import {
	CAPABILITY_TRANSPORT_ERROR_CODES,
	createCapabilityTransportError,
	type NetworkResourceLabel,
} from "./NetworkErrors";

export const MAX_NETWORK_RESOLVED_ADDRESSES = 16;

/**
 * Trusted DNS primitive. The core strictly validates and chooses returned
 * addresses. The resolver must observe abort, synchronously initiate
 * cancellation, and settle promptly so cancelled work cannot retain a permit.
 */
export type NetworkNameResolver = (
	hostname: string,
	signal: AbortSignal,
) => readonly string[] | PromiseLike<readonly string[]>;

/**
 * A pinned request that cannot trigger a second hostname lookup by itself.
 *
 * The adapter is part of the trusted network boundary. It must connect directly
 * to `connectAddress`, use `serverName` only for TLS SNI, send `hostHeader` and
 * `requestTarget` without ambient credentials, disable redirects, report the
 * socket's actual remote address, and make `close` synchronously initiate
 * shutdown, settle promptly, and promptly settle pending body iteration. HTTPS
 * must use normal CA-chain validation and verify the certificate against
 * `serverName`, or against the IP SAN for a literal target. Insecure TLS
 * overrides are prohibited. Before returning a response, the adapter must
 * observe abort, synchronously cancel its work, and settle promptly. Platforms
 * that cannot satisfy this contract must fail closed.
 */
export interface PinnedNetworkHopRequest {
	readonly protocol: NetworkProtocol;
	readonly connectAddress: string;
	readonly port: number;
	readonly serverName?: string;
	readonly hostHeader: string;
	/** Exact path and query characters derived from the capability target. */
	readonly requestTarget: string;
	readonly method: "GET";
	readonly credentials: "omit";
	readonly redirect: "manual";
	readonly signal: AbortSignal;
}

export interface PinnedNetworkHopResponse {
	readonly status: number;
	readonly location?: string;
	readonly body: AsyncIterable<Uint8Array>;
	/** Actual remote address read from the connected socket. */
	readonly connectedAddress: string;
	/** Must synchronously begin shutdown and promptly settle close plus body work. */
	readonly close: () => void | PromiseLike<void>;
}

export type PinnedNetworkHopAdapter = (
	request: PinnedNetworkHopRequest,
) => PinnedNetworkHopResponse | PromiseLike<PinnedNetworkHopResponse>;

export interface PinnedNetworkHop {
	readonly status: number;
	readonly location?: string;
	readonly body: AsyncIterable<Uint8Array>;
	readonly close: () => Promise<void>;
}

const missingProperty = Symbol("missing-property");

function isObject(value: unknown): value is object {
	return (typeof value === "object" && value !== null) || typeof value === "function";
}

function getOwnDataValue(record: object, property: string): unknown | typeof missingProperty {
	const descriptor = Object.getOwnPropertyDescriptor(record, property);
	return descriptor && "value" in descriptor ? descriptor.value : missingProperty;
}

/** @internal Pure validation helper for CapabilityScopedTransport. */
export function snapshotResolvedAddresses(
	value: unknown,
	resourceLabel: NetworkResourceLabel,
): readonly string[] {
	try {
		if (
			!Array.isArray(value) ||
			value.length === 0 ||
			value.length > MAX_NETWORK_RESOLVED_ADDRESSES
		) {
			throw new Error();
		}
		const keys = Reflect.ownKeys(value);
		if (keys.length !== value.length + 1 || !keys.includes("length")) throw new Error();

		const addresses: string[] = [];
		for (let index = 0; index < value.length; index += 1) {
			const address = getOwnDataValue(value, String(index));
			if (
				address === missingProperty ||
				!isResolvedAddressLiteral(address) ||
				addresses.some((existing) => resolvedAddressesEqual(existing, address))
			) {
				throw new Error();
			}
			addresses.push(address);
		}
		return Object.freeze(addresses);
	} catch {
		throw createCapabilityTransportError(
			CAPABILITY_TRANSPORT_ERROR_CODES.addressRejected,
			resourceLabel,
		);
	}
}

/** @internal Pure validation helper for CapabilityScopedTransport. */
export function snapshotHopResponse(
	value: unknown,
	expectedAddress: string,
	resourceLabel: NetworkResourceLabel,
): Omit<PinnedNetworkHop, "close"> & { readonly close: () => void | PromiseLike<void> } {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
		const keys = Reflect.ownKeys(value);
		const required = ["status", "body", "connectedAddress", "close"];
		if (
			keys.some((key) => typeof key !== "string") ||
			keys.length < required.length ||
			keys.length > required.length + 1 ||
			required.some((key) => !keys.includes(key)) ||
			(keys.length === required.length + 1 && !keys.includes("location"))
		) {
			throw new Error();
		}

		const status = getOwnDataValue(value, "status");
		const body = getOwnDataValue(value, "body");
		const connectedAddress = getOwnDataValue(value, "connectedAddress");
		const close = getOwnDataValue(value, "close");
		const location = keys.includes("location") ? getOwnDataValue(value, "location") : undefined;
		if (
			!Number.isInteger(status) ||
			(status as number) < 100 ||
			(status as number) > 599 ||
			!isObject(body) ||
			typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function" ||
			!resolvedAddressesEqual(connectedAddress, expectedAddress) ||
			typeof close !== "function" ||
			(location !== undefined && typeof location !== "string")
		) {
			throw new Error();
		}

		return Object.freeze({
			status: status as number,
			body: body as AsyncIterable<Uint8Array>,
			close: (): void | PromiseLike<void> =>
				Reflect.apply(
					close as (...arguments_: unknown[]) => unknown,
					value,
					[],
				) as void | PromiseLike<void>,
			...(location === undefined ? {} : { location }),
		});
	} catch {
		throw createCapabilityTransportError(
			CAPABILITY_TRANSPORT_ERROR_CODES.adapterResponseInvalid,
			resourceLabel,
		);
	}
}

/** @internal Pure request derivation helper for CapabilityScopedTransport. */
export function targetRequestParts(
	target: string,
	policy: TargetPolicyView,
): { readonly hostHeader: string; readonly requestTarget: string } {
	const authorityStart = target.indexOf("//") + 2;
	const remainder = target.slice(authorityStart);
	const separatorIndex = remainder.search(/[/?]/);
	const requestTarget =
		separatorIndex === -1
			? "/"
			: remainder[separatorIndex] === "?"
				? `/${remainder.slice(separatorIndex)}`
				: remainder.slice(separatorIndex);
	const host = policy.normalizedHostname.includes(":")
		? `[${policy.normalizedHostname}]`
		: policy.normalizedHostname;
	const defaultPort = policy.protocol === "https:" ? 443 : 80;
	return Object.freeze({
		hostHeader: `${host}${policy.port === defaultPort ? "" : `:${policy.port}`}`,
		requestTarget,
	});
}

/** @internal One-shot response lifecycle helper for CapabilityScopedTransport. */
export function manageHopResponse(
	response: ReturnType<typeof snapshotHopResponse>,
	signal: AbortSignal,
): PinnedNetworkHop {
	let closePromise: Promise<void> | undefined;
	const closeOnce = (): Promise<void> => {
		if (!closePromise) {
			let resolveClose!: () => void;
			let rejectClose!: (error: unknown) => void;
			closePromise = new Promise<void>((resolve, reject) => {
				resolveClose = resolve;
				rejectClose = reject;
			});
			try {
				Promise.resolve(response.close()).then(resolveClose, rejectClose);
			} catch (error) {
				rejectClose(error);
			}
		}
		return closePromise;
	};
	const onAbort = (): void => {
		void closeOnce().catch(() => undefined);
	};
	signal.addEventListener("abort", onAbort, { once: true });
	if (signal.aborted) onAbort();

	return Object.freeze({
		status: response.status,
		body: response.body,
		...(response.location === undefined ? {} : { location: response.location }),
		close: async (): Promise<void> => {
			signal.removeEventListener("abort", onAbort);
			await closeOnce();
		},
	});
}

/** @internal Best-effort cleanup helper for malformed adapter responses. */
export async function closeInvalidHopResponse(value: unknown): Promise<void> {
	if (!isObject(value)) return;
	try {
		const close = getOwnDataValue(value, "close");
		if (typeof close === "function") await Reflect.apply(close, value, []);
	} catch {
		// The invalid adapter response remains the only caller-visible failure.
	}
}
