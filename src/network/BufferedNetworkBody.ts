import {
	assertNetworkOperationActive,
	CAPABILITY_TRANSPORT_ERROR_CODES,
	createCapabilityTransportError,
	sanitizeCapabilityTransportError,
	type NetworkResourceLabel,
} from "./NetworkErrors";

export const MAX_BUFFERED_NETWORK_RESPONSE_BYTES = 12 * 1024 * 1024;
export const MAX_BUFFERED_NETWORK_CHUNKS = 16_384;

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"length",
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	TYPED_ARRAY_PROTOTYPE,
	"byteLength",
)?.get;

function getByteChunkLength(value: unknown): number | undefined {
	if (
		!ArrayBuffer.isView(value) ||
		!TYPED_ARRAY_LENGTH_GETTER ||
		!TYPED_ARRAY_BYTE_LENGTH_GETTER
	) {
		return undefined;
	}
	try {
		const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as unknown;
		const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as unknown;
		return Number.isSafeInteger(length) && length === byteLength
			? (byteLength as number)
			: undefined;
	} catch {
		return undefined;
	}
}

function growBuffer(
	buffer: Uint8Array<ArrayBuffer>,
	required: number,
	limit: number,
): Uint8Array<ArrayBuffer> {
	if (buffer.byteLength >= required) return buffer;
	let capacity = Math.max(1024, buffer.byteLength);
	while (capacity < required) capacity = Math.min(limit, Math.max(required, capacity * 2));
	const grown = new Uint8Array(capacity);
	grown.set(buffer);
	return grown;
}

export async function consumeBufferedNetworkBody(
	body: AsyncIterable<Uint8Array>,
	maxResponseBytes: number,
	resourceLabel: NetworkResourceLabel,
	signal: AbortSignal,
): Promise<Uint8Array> {
	let buffer = new Uint8Array(0);
	let totalBytes = 0;
	let chunkCount = 0;
	try {
		for await (const chunk of body) {
			assertNetworkOperationActive(signal, resourceLabel);
			chunkCount += 1;
			const chunkLength = getByteChunkLength(chunk);
			if (chunkLength === undefined) {
				throw createCapabilityTransportError(
					CAPABILITY_TRANSPORT_ERROR_CODES.adapterResponseInvalid,
					resourceLabel,
				);
			}
			if (
				chunkCount > MAX_BUFFERED_NETWORK_CHUNKS ||
				chunkLength > maxResponseBytes - totalBytes
			) {
				throw createCapabilityTransportError(
					CAPABILITY_TRANSPORT_ERROR_CODES.responseTooLarge,
					resourceLabel,
				);
			}
			if (chunkLength === 0) continue;
			buffer = growBuffer(buffer, totalBytes + chunkLength, maxResponseBytes);
			buffer.set(chunk as unknown as ArrayLike<number>, totalBytes);
			totalBytes += chunkLength;
		}
		return buffer.subarray(0, totalBytes);
	} catch (error) {
		throw sanitizeCapabilityTransportError(error, resourceLabel);
	}
}
