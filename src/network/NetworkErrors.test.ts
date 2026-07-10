import { describe, expect, it } from "vitest";
import {
	CAPABILITY_TRANSPORT_ERROR_CODES,
	CapabilityTransportError,
	createCapabilityTransportError,
	createNetworkResourceLabel,
	isNetworkResourceLabel,
	MAX_NETWORK_RESOURCE_LABEL_LENGTH,
	NETWORK_ERROR_CODES,
	NETWORK_STATIC_RESOURCE_LABELS,
	NetworkDeadlineError,
	NetworkDisposedError,
	NetworkInvariantError,
	NetworkOperationError,
	NetworkQueueFullError,
	NetworkSchedulerError,
	sanitizeCapabilityTransportError,
	type CapabilityTransportErrorCode,
	type NetworkResourceLabel,
} from "./NetworkErrors";

describe("network resource labels", () => {
	it.each([
		"feed metadata",
		"episode media",
		"provider operation",
		`podnotes-feed-${"a".repeat(64)}`,
		`podnotes-episode-${"0".repeat(64)}`,
	])("accepts the explicit target-free label %s", (value) => {
		expect(isNetworkResourceLabel(value)).toBe(true);
		expect(createNetworkResourceLabel(value)).toBe(value);
	});

	it.each([
		"",
		"Feed metadata",
		"sk-secret",
		"private token",
		"episode-media",
		"provider operation 2",
		"https://secret.example/feed?token=raw",
		"secret.example",
		"localhost:8080",
		"feed/path",
		"feed\\path",
		"feed?token",
		"feed#fragment",
		"user@example",
		"token=value",
		"space  doubled",
		" leading",
		"trailing ",
		"one two three four five six seven",
		"x".repeat(MAX_NETWORK_RESOURCE_LABEL_LENGTH + 1),
		`podnotes-feed-${"g".repeat(64)}`,
		`podnotes-episode-${"a".repeat(63)}`,
	])("rejects non-label input without echoing it: %s", (value) => {
		expect(isNetworkResourceLabel(value)).toBe(false);
		let caught: unknown;
		try {
			createNetworkResourceLabel(value);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(TypeError);
		if (value.length > 0) expect(String(caught)).not.toContain(value);
	});

	it("rejects non-string values", () => {
		expect(isNetworkResourceLabel(undefined)).toBe(false);
		expect(isNetworkResourceLabel({ toString: () => "feed metadata" })).toBe(false);
	});

	it("keeps the static application-label registry immutable", () => {
		expect(Object.isFrozen(NETWORK_STATIC_RESOURCE_LABELS)).toBe(true);
		expect(NETWORK_STATIC_RESOURCE_LABELS).toContain("podcast subscription");
		expect(() =>
			(NETWORK_STATIC_RESOURCE_LABELS as unknown as string[]).push("secret"),
		).toThrow();
	});
});

describe("capability transport error authority", () => {
	const label = createNetworkResourceLabel("feed metadata");

	it("rejects unregistered runtime codes and labels before trusting an error", () => {
		expect(() =>
			createCapabilityTransportError(
				"NETWORK_INVENTED" as CapabilityTransportErrorCode,
				label,
			),
		).toThrow(TypeError);
		expect(() =>
			createCapabilityTransportError(
				CAPABILITY_TRANSPORT_ERROR_CODES.operationFailed,
				"https://secret.example/feed?token=raw" as NetworkResourceLabel,
			),
		).toThrow(TypeError);
	});

	it("sanitizes a directly constructed error that never passed the trusted mint", () => {
		const forged = new CapabilityTransportError(
			CAPABILITY_TRANSPORT_ERROR_CODES.responseTooLarge,
			"https://secret.example/feed?token=raw" as NetworkResourceLabel,
		);

		const sanitized = sanitizeCapabilityTransportError(forged, label);

		expect(sanitized).not.toBe(forged);
		expect(sanitized.code).toBe(CAPABILITY_TRANSPORT_ERROR_CODES.operationFailed);
		expect(sanitized.resourceLabel).toBe(label);
		expect(String(sanitized)).not.toContain("secret.example");
	});
});

describe("network scheduler errors", () => {
	const label = createNetworkResourceLabel("feed metadata");

	it.each([
		[NetworkDeadlineError, "NetworkDeadlineError", NETWORK_ERROR_CODES.deadlineExceeded],
		[NetworkDisposedError, "NetworkDisposedError", NETWORK_ERROR_CODES.sessionDisposed],
		[NetworkQueueFullError, "NetworkQueueFullError", NETWORK_ERROR_CODES.queueFull],
		[NetworkOperationError, "NetworkOperationError", NETWORK_ERROR_CODES.operationFailed],
		[NetworkInvariantError, "NetworkInvariantError", NETWORK_ERROR_CODES.internalInvariant],
	] as const)("exposes only the stable %s contract", (ErrorType, name, code) => {
		const error = new ErrorType(label);

		expect(error).toBeInstanceOf(NetworkSchedulerError);
		expect(error.name).toBe(name);
		expect(error.code).toBe(code);
		expect(error.resourceLabel).toBe(label);
		expect(error.message).toBe(`${code}: ${label}`);
		expect(error).not.toHaveProperty("cause");
	});

	it("keeps the stable code table immutable", () => {
		expect(Object.isFrozen(NETWORK_ERROR_CODES)).toBe(true);
		expect(() => Object.assign(NETWORK_ERROR_CODES, { queueFull: "CHANGED" })).toThrow();
		expect(NETWORK_ERROR_CODES.queueFull).toBe("NETWORK_QUEUE_FULL");
	});
});
