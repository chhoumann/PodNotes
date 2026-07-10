const HANDLE_RESOURCE_LABEL_PATTERN = /^podnotes-(?:feed|episode)-[0-9a-f]{64}$/;

export const NETWORK_STATIC_RESOURCE_LABELS = Object.freeze([
	"podcast subscription",
	"podcast artwork",
	"podcast site",
	"episode audio",
	"episode chapters",
	"episode artwork",
	"episode page",
	"feed metadata",
	"episode media",
	"provider operation",
] as const);

const staticResourceLabels = new Set<string>(NETWORK_STATIC_RESOURCE_LABELS);

export const MAX_NETWORK_RESOURCE_LABEL_LENGTH = 96;

declare const networkResourceLabelBrand: unique symbol;

/**
 * An application-owned description or opaque handle that is safe to expose in
 * an error. Raw URLs, origins, paths, response data, and provider messages are
 * deliberately outside this type's runtime grammar.
 */
export type NetworkResourceLabel = string & {
	readonly [networkResourceLabelBrand]: true;
};

export const NETWORK_ERROR_CODES = Object.freeze({
	deadlineExceeded: "NETWORK_DEADLINE_EXCEEDED",
	sessionDisposed: "NETWORK_SESSION_DISPOSED",
	queueFull: "NETWORK_QUEUE_FULL",
	operationFailed: "NETWORK_OPERATION_FAILED",
	internalInvariant: "NETWORK_INTERNAL_INVARIANT",
} as const);

export type NetworkErrorCode = (typeof NETWORK_ERROR_CODES)[keyof typeof NETWORK_ERROR_CODES];

export const CAPABILITY_TRANSPORT_ERROR_CODES = Object.freeze({
	resourceRejected: "NETWORK_RESOURCE_REJECTED",
	targetRejected: "NETWORK_TARGET_REJECTED",
	addressRejected: "NETWORK_ADDRESS_REJECTED",
	adapterResponseInvalid: "NETWORK_ADAPTER_RESPONSE_INVALID",
	redirectRejected: "NETWORK_REDIRECT_REJECTED",
	redirectLimit: "NETWORK_REDIRECT_LIMIT",
	statusRejected: "NETWORK_STATUS_REJECTED",
	responseTooLarge: "NETWORK_RESPONSE_TOO_LARGE",
	operationFailed: "NETWORK_OPERATION_FAILED",
} as const);

export type CapabilityTransportErrorCode =
	(typeof CAPABILITY_TRANSPORT_ERROR_CODES)[keyof typeof CAPABILITY_TRANSPORT_ERROR_CODES];

const capabilityTransportErrorCodes = new Set<string>(
	Object.values(CAPABILITY_TRANSPORT_ERROR_CODES),
);
const internallyIssuedCapabilityErrors = new WeakSet<object>();

export function isNetworkResourceLabel(value: unknown): value is NetworkResourceLabel {
	if (typeof value !== "string" || value.length > MAX_NETWORK_RESOURCE_LABEL_LENGTH) {
		return false;
	}

	return staticResourceLabels.has(value) || HANDLE_RESOURCE_LABEL_PATTERN.test(value);
}

export function createNetworkResourceLabel(value: string): NetworkResourceLabel {
	if (!isNetworkResourceLabel(value)) {
		throw new TypeError(
			"Network resource labels must be registered application labels or PodNotes handles.",
		);
	}
	return value;
}

/** Stable target-free error from the capability-scoped transport boundary. */
export class CapabilityTransportError extends Error {
	constructor(
		public readonly code: CapabilityTransportErrorCode,
		public readonly resourceLabel: NetworkResourceLabel,
	) {
		super(`${code}: ${resourceLabel}`);
		this.name = "CapabilityTransportError";
	}
}

/** @internal Creates errors that may safely cross an adapter boundary. */
export function createCapabilityTransportError(
	code: CapabilityTransportErrorCode,
	resourceLabel: NetworkResourceLabel,
): CapabilityTransportError {
	if (!capabilityTransportErrorCodes.has(code) || !isNetworkResourceLabel(resourceLabel)) {
		throw new TypeError(
			"Capability transport errors require a registered code and safe label.",
		);
	}
	const error = new CapabilityTransportError(code, resourceLabel);
	internallyIssuedCapabilityErrors.add(error);
	return Object.freeze(error);
}

/** @internal Drops arbitrary resolver, adapter, and response failure details. */
export function sanitizeCapabilityTransportError(
	error: unknown,
	resourceLabel: NetworkResourceLabel,
): CapabilityTransportError {
	return typeof error === "object" &&
		error !== null &&
		internallyIssuedCapabilityErrors.has(error)
		? (error as CapabilityTransportError)
		: createCapabilityTransportError(
				CAPABILITY_TRANSPORT_ERROR_CODES.operationFailed,
				resourceLabel,
			);
}

/** @internal Shared cancellation check for bounded network operations. */
export function assertNetworkOperationActive(
	signal: AbortSignal,
	resourceLabel: NetworkResourceLabel,
): void {
	if (signal.aborted) {
		throw createCapabilityTransportError(
			CAPABILITY_TRANSPORT_ERROR_CODES.operationFailed,
			resourceLabel,
		);
	}
}

/**
 * Scheduler errors intentionally expose only a stable code and the explicit
 * target-free label supplied by application code. Raw adapter failures are
 * never attached as `cause` or interpolated into the message.
 */
export class NetworkSchedulerError extends Error {
	constructor(
		public readonly code: NetworkErrorCode,
		public readonly resourceLabel: NetworkResourceLabel,
	) {
		super(`${code}: ${resourceLabel}`);
		this.name = "NetworkSchedulerError";
	}
}

export class NetworkDeadlineError extends NetworkSchedulerError {
	constructor(resourceLabel: NetworkResourceLabel) {
		super(NETWORK_ERROR_CODES.deadlineExceeded, resourceLabel);
		this.name = "NetworkDeadlineError";
	}
}

export class NetworkDisposedError extends NetworkSchedulerError {
	constructor(resourceLabel: NetworkResourceLabel) {
		super(NETWORK_ERROR_CODES.sessionDisposed, resourceLabel);
		this.name = "NetworkDisposedError";
	}
}

export class NetworkQueueFullError extends NetworkSchedulerError {
	constructor(resourceLabel: NetworkResourceLabel) {
		super(NETWORK_ERROR_CODES.queueFull, resourceLabel);
		this.name = "NetworkQueueFullError";
	}
}

export class NetworkOperationError extends NetworkSchedulerError {
	constructor(resourceLabel: NetworkResourceLabel) {
		super(NETWORK_ERROR_CODES.operationFailed, resourceLabel);
		this.name = "NetworkOperationError";
	}
}

export class NetworkInvariantError extends NetworkSchedulerError {
	constructor(resourceLabel: NetworkResourceLabel) {
		super(NETWORK_ERROR_CODES.internalInvariant, resourceLabel);
		this.name = "NetworkInvariantError";
	}
}
