import { Platform, type SecretStorage } from "obsidian";
import { createDesktopNetworkPrimitives } from "src/network/DesktopPinnedNetworkAdapter";
import { NetworkScheduler } from "src/network/NetworkScheduler";

import {
	createFeedCapabilityNetworkRuntime,
	type FeedCapabilityBroker,
	type FeedCapabilityNetworkRuntime,
	type FeedCapabilityTransport,
} from "./FeedCapabilityBroker";
import { FeedCapabilityRepository } from "./FeedCapabilityRepository";

export type PodNotesNetworkServicesUnavailableReason =
	| "unsupported-platform"
	| "initialization-failed";

interface PodNotesNetworkServicesLifecycle {
	dispose(): void;
	isDisposed(): boolean;
}

export interface AvailablePodNotesNetworkServices extends PodNotesNetworkServicesLifecycle {
	readonly status: "available";
	readonly feedCapabilityBroker: FeedCapabilityBroker;
	readonly feedCapabilityTransport: FeedCapabilityTransport;
}

export interface UnavailablePodNotesNetworkServices extends PodNotesNetworkServicesLifecycle {
	readonly status: "unavailable";
	readonly reason: PodNotesNetworkServicesUnavailableReason;
}

export type PodNotesNetworkServices =
	| AvailablePodNotesNetworkServices
	| UnavailablePodNotesNetworkServices;

function createUnavailableServices(
	reason: PodNotesNetworkServicesUnavailableReason,
): UnavailablePodNotesNetworkServices {
	let disposed = false;
	return Object.freeze({
		status: "unavailable",
		reason,
		dispose(): void {
			disposed = true;
		},
		isDisposed(): boolean {
			return disposed;
		},
	});
}

function createAvailableServices(
	runtime: FeedCapabilityNetworkRuntime,
): AvailablePodNotesNetworkServices {
	let disposed = false;
	return Object.freeze({
		status: "available",
		feedCapabilityBroker: runtime.broker,
		feedCapabilityTransport: runtime.transport,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			runtime.dispose();
		},
		isDisposed(): boolean {
			return disposed;
		},
	});
}

/**
 * Plugin-scoped composition boundary for capability-authorized networking.
 * Legacy callers remain disconnected until they can migrate to brokered access.
 */
export function createPodNotesNetworkServices(
	secretStorage: SecretStorage,
): PodNotesNetworkServices {
	if (!Platform.isDesktopApp) {
		return createUnavailableServices("unsupported-platform");
	}

	let runtime: FeedCapabilityNetworkRuntime | undefined;
	try {
		const { nameResolver, adapter } = createDesktopNetworkPrimitives();
		const repository = new FeedCapabilityRepository(secretStorage);
		const scheduler = new NetworkScheduler();
		runtime = createFeedCapabilityNetworkRuntime(repository, nameResolver, adapter, scheduler);
		return createAvailableServices(runtime);
	} catch {
		try {
			runtime?.dispose();
		} catch {
			// Initialization remains fail-closed even when partial teardown fails.
		}
		return createUnavailableServices("initialization-failed");
	}
}
