import type { SecretStorage } from "obsidian";
import { Platform } from "obsidian";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	desktopFactory: vi.fn(),
	repositoryConstructor: vi.fn(),
	repositoryInstances: [] as object[],
	runtimeFactory: vi.fn(),
	schedulerConstructor: vi.fn(),
	schedulerInstances: [] as object[],
}));

vi.mock("src/network/DesktopPinnedNetworkAdapter", () => ({
	createDesktopNetworkPrimitives: mocks.desktopFactory,
}));

vi.mock("./FeedCapabilityRepository", () => ({
	FeedCapabilityRepository: class MockFeedCapabilityRepository {
		constructor(storage: unknown) {
			mocks.repositoryInstances.push(this);
			mocks.repositoryConstructor(storage, this);
		}
	},
}));

vi.mock("src/network/NetworkScheduler", () => ({
	NetworkScheduler: class MockNetworkScheduler {
		constructor() {
			mocks.schedulerInstances.push(this);
			mocks.schedulerConstructor(this);
		}
	},
}));

vi.mock("./FeedCapabilityBroker", () => ({
	createFeedCapabilityNetworkRuntime: mocks.runtimeFactory,
}));

import { createPodNotesNetworkServices } from "./PodNotesNetworkServices";

const originalIsDesktopApp = Platform.isDesktopApp;
const secretStorage = Object.freeze({}) as SecretStorage;
const nameResolver = Object.freeze({ name: "name-resolver" });
const adapter = Object.freeze({ name: "pinned-network-hop-adapter" });
const broker = Object.freeze({ name: "feed-capability-broker" });
const transport = Object.freeze({ name: "feed-capability-transport" });
let runtimeDispose: ReturnType<typeof vi.fn>;

beforeEach(() => {
	Platform.isDesktopApp = true;
	mocks.desktopFactory.mockReset();
	mocks.repositoryConstructor.mockReset();
	mocks.repositoryInstances.length = 0;
	mocks.runtimeFactory.mockReset();
	mocks.schedulerConstructor.mockReset();
	mocks.schedulerInstances.length = 0;
	runtimeDispose = vi.fn();
	mocks.desktopFactory.mockReturnValue({ nameResolver, adapter });
	mocks.runtimeFactory.mockReturnValue({ broker, transport, dispose: runtimeDispose });
});

afterAll(() => {
	Platform.isDesktopApp = originalIsDesktopApp;
});

describe("createPodNotesNetworkServices", () => {
	it("returns a frozen unavailable service on mobile without touching desktop composition", () => {
		Platform.isDesktopApp = false;

		const services = createPodNotesNetworkServices(secretStorage);

		expect(services).toMatchObject({
			status: "unavailable",
			reason: "unsupported-platform",
		});
		expect(Object.isFrozen(services)).toBe(true);
		expect(mocks.desktopFactory).not.toHaveBeenCalled();
		expect(mocks.repositoryConstructor).not.toHaveBeenCalled();
		expect(mocks.schedulerConstructor).not.toHaveBeenCalled();
		expect(mocks.runtimeFactory).not.toHaveBeenCalled();
		expect(services.isDisposed()).toBe(false);

		services.dispose();
		services.dispose();

		expect(services.isDisposed()).toBe(true);
	});

	it("constructs exactly one desktop repository, scheduler, and runtime", () => {
		const services = createPodNotesNetworkServices(secretStorage);

		expect(mocks.desktopFactory).toHaveBeenCalledOnce();
		expect(mocks.repositoryConstructor).toHaveBeenCalledOnce();
		expect(mocks.repositoryConstructor).toHaveBeenCalledWith(
			secretStorage,
			mocks.repositoryInstances[0],
		);
		expect(mocks.schedulerConstructor).toHaveBeenCalledOnce();
		expect(mocks.runtimeFactory).toHaveBeenCalledOnce();
		expect(mocks.runtimeFactory).toHaveBeenCalledWith(
			mocks.repositoryInstances[0],
			nameResolver,
			adapter,
			mocks.schedulerInstances[0],
		);
		expect(services.status).toBe("available");
		if (services.status !== "available") throw new Error("Expected available services.");
		expect(services).toMatchObject({
			feedCapabilityBroker: broker,
			feedCapabilityTransport: transport,
		});
		expect(Object.isFrozen(services)).toBe(true);
		expect(services).not.toHaveProperty("feedCapabilityRepository");
		expect(services).not.toHaveProperty("scheduler");
		expect(services).not.toHaveProperty("runtime");
	});

	it("fails closed when desktop primitives cannot be created", () => {
		mocks.desktopFactory.mockImplementation(() => {
			throw new Error("desktop networking unavailable");
		});

		const services = createPodNotesNetworkServices(secretStorage);

		expect(services).toMatchObject({
			status: "unavailable",
			reason: "initialization-failed",
		});
		expect(Object.isFrozen(services)).toBe(true);
		expect(mocks.repositoryConstructor).not.toHaveBeenCalled();
		expect(mocks.schedulerConstructor).not.toHaveBeenCalled();
		expect(mocks.runtimeFactory).not.toHaveBeenCalled();
		expect(services).not.toHaveProperty("feedCapabilityBroker");
		expect(services).not.toHaveProperty("feedCapabilityTransport");
	});

	it("fails closed when the brokered runtime cannot be created", () => {
		mocks.runtimeFactory.mockImplementation(() => {
			throw new Error("runtime unavailable");
		});

		const services = createPodNotesNetworkServices(secretStorage);

		expect(services).toMatchObject({
			status: "unavailable",
			reason: "initialization-failed",
		});
		expect(mocks.desktopFactory).toHaveBeenCalledOnce();
		expect(mocks.repositoryConstructor).toHaveBeenCalledOnce();
		expect(mocks.schedulerConstructor).toHaveBeenCalledOnce();
		expect(mocks.runtimeFactory).toHaveBeenCalledOnce();
		expect(services).not.toHaveProperty("feedCapabilityBroker");
		expect(services).not.toHaveProperty("feedCapabilityTransport");
	});

	it("owns runtime disposal through one idempotent aggregate lifecycle", () => {
		const services = createPodNotesNetworkServices(secretStorage);
		expect(services.status).toBe("available");
		expect(services.isDisposed()).toBe(false);

		services.dispose();
		services.dispose();

		expect(runtimeDispose).toHaveBeenCalledOnce();
		expect(services.isDisposed()).toBe(true);
	});

	it("best-effort disposes a runtime when final service composition fails", () => {
		const partialDispose = vi.fn();
		mocks.runtimeFactory.mockReturnValue({
			get broker() {
				throw new Error("invalid broker facade");
			},
			transport,
			dispose: partialDispose,
		});

		const services = createPodNotesNetworkServices(secretStorage);

		expect(services).toMatchObject({
			status: "unavailable",
			reason: "initialization-failed",
		});
		expect(partialDispose).toHaveBeenCalledOnce();
	});
});
