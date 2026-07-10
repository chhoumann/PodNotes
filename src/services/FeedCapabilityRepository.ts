import type { SecretStorage } from "obsidian";
import {
	MAX_FEED_CAPABILITY_REFERENCE_ATTEMPTS,
	feedCapabilityReferenceForAttempt,
	getFeedCapabilityManifestStorageId,
	getFeedCapabilityPageStorageId,
	isFeedCapabilityReferenceFor,
	type FeedCapabilityReference,
} from "src/security/feedCapabilityReferences";
import {
	FEED_CAPABILITY_STORAGE_SCHEMA_VERSION,
	MAX_SECRET_STORAGE_ITEM_BYTES,
	makeManifest,
	preparePages,
	reconstructEnvelope,
	serializePhysicalItem,
	serializedByteLength,
	sha256Hex,
	validateManifest,
	validateNamespaceMarker,
	validatePage,
	type FeedCapabilityManifest,
	type FeedCapabilityNamespaceMarker,
	type FeedCapabilityPage,
	type FeedCapabilityPageDescriptor,
	type PhysicalSlot,
} from "src/security/feedCapabilityStorage";
import {
	validateFeedCapabilityEnvelope,
	type EpisodeResourcesEnvelope,
	type FeedCapabilityEnvelope,
} from "src/security/targetEnvelopes";
import { isEpisodeHandle, type EpisodeHandle, type FeedHandle } from "src/security/resourceHandles";

export { MAX_SECRET_STORAGE_ITEM_BYTES } from "src/security/feedCapabilityStorage";
export {
	MAX_SECRET_STORAGE_ID_CHARACTERS,
	isFeedCapabilityReferenceFor,
	type FeedCapabilityReference,
} from "src/security/feedCapabilityReferences";

export type CapabilityStatus = "available" | "missing" | "invalid" | "unavailable";

export type CapabilityReadResult<T> =
	| { status: "available"; value: T }
	| { status: Exclude<CapabilityStatus, "available"> };

type ReadResult<T> = CapabilityReadResult<T>;

interface LoadedGeneration {
	bundle: FeedCapabilityEnvelope;
	manifest: FeedCapabilityManifest;
	manifestSlot: PhysicalSlot;
}

interface LoadedManifestSlot {
	manifest: FeedCapabilityManifest;
	serialized: string;
	slot: PhysicalSlot;
}

export type FeedCapabilityCommitRegistry = WeakMap<SecretStorage, Map<FeedHandle, Promise<void>>>;

export interface FeedCapabilityRepositoryOptions {
	commitRegistry?: FeedCapabilityCommitRegistry;
	validatePhysicalManifest?: typeof validateManifest;
}

const COMMIT_REGISTRY_SYMBOL = Symbol.for("podnotes.feed-capability-commit-registry.v1");

function globalCommitRegistry(): FeedCapabilityCommitRegistry {
	// oxlint-disable-next-line obsidianmd/no-global-this -- Symbol.for keeps the in-flight commit registry stable across plugin hot reloads in the same runtime.
	const host = globalThis as unknown as { [key: symbol]: unknown };
	const existing = host[COMMIT_REGISTRY_SYMBOL];
	if (existing instanceof WeakMap) return existing as FeedCapabilityCommitRegistry;
	const registry: FeedCapabilityCommitRegistry = new WeakMap();
	host[COMMIT_REGISTRY_SYMBOL] = registry;
	return registry;
}

export class FeedCapabilityRepositoryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FeedCapabilityRepositoryError";
	}
}

function manifestKey(reference: string, slot: PhysicalSlot): string {
	const id = getFeedCapabilityManifestStorageId(reference, slot);
	if (!id) throw new Error("Invalid SecretStorage ID");
	return id;
}

function pageKey(reference: string, index: string, slot: PhysicalSlot): string {
	const id = getFeedCapabilityPageStorageId(reference, slot, index);
	if (!id) throw new Error("Invalid SecretStorage ID");
	return id;
}

function inactiveSlot(active?: PhysicalSlot): PhysicalSlot {
	return active === "a" ? "b" : "a";
}

function parseBoundedItem<T>(serialized: string, validate: (value: unknown) => T | null): T | null {
	if (
		serialized.length > MAX_SECRET_STORAGE_ITEM_BYTES ||
		serializedByteLength(serialized) > MAX_SECRET_STORAGE_ITEM_BYTES
	) {
		return null;
	}
	try {
		return validate(JSON.parse(serialized));
	} catch {
		return null;
	}
}

function markerFor(feedId: FeedHandle): FeedCapabilityNamespaceMarker {
	return {
		schemaVersion: FEED_CAPABILITY_STORAGE_SCHEMA_VERSION,
		kind: "feed-capability-namespace",
		feedId,
	};
}

function manifestsDiverge(left: LoadedManifestSlot, right: LoadedManifestSlot): boolean {
	return JSON.stringify(left.manifest) !== JSON.stringify(right.manifest);
}

export class FeedCapabilityRepository {
	private readonly commitQueues: Map<FeedHandle, Promise<void>>;
	private readonly validatePhysicalManifest: typeof validateManifest;

	constructor(
		private readonly storage: SecretStorage,
		options: FeedCapabilityRepositoryOptions = {},
	) {
		const registry = options.commitRegistry ?? globalCommitRegistry();
		const existing = registry.get(storage);
		this.commitQueues = existing ?? new Map();
		if (!existing) registry.set(storage, this.commitQueues);
		this.validatePhysicalManifest = options.validatePhysicalManifest ?? validateManifest;
	}

	async storeFeedCapabilities(value: unknown): Promise<FeedCapabilityReference> {
		const envelope = validateFeedCapabilityEnvelope(value);
		if (!envelope) {
			throw new FeedCapabilityRepositoryError("Invalid feed capability envelope.");
		}
		return this.withFeedCommit(envelope.feedId, () => this.storeValidatedEnvelope(envelope));
	}

	private async storeValidatedEnvelope(
		envelope: FeedCapabilityEnvelope,
	): Promise<FeedCapabilityReference> {
		const reference = await this.allocateNamespace(envelope.feedId);
		const current = await this.loadGeneration(envelope.feedId, reference);
		if (current.status === "invalid") {
			throw new FeedCapabilityRepositoryError("Stored feed capabilities are invalid.");
		}
		if (current.status === "unavailable") {
			throw new FeedCapabilityRepositoryError("SecretStorage is unavailable.");
		}
		if (
			current.status === "available" &&
			JSON.stringify(current.value.bundle) === JSON.stringify(envelope)
		) {
			return reference;
		}

		const generation =
			current.status === "available" ? current.value.manifest.generation + 1 : 1;
		if (!Number.isSafeInteger(generation)) {
			throw new FeedCapabilityRepositoryError("Feed capability generation is exhausted.");
		}

		let contentDigest: string;
		let preparedPages: Awaited<ReturnType<typeof preparePages>>;
		try {
			contentDigest = await sha256Hex(JSON.stringify(envelope));
			preparedPages = await preparePages(envelope, generation);
		} catch {
			throw new FeedCapabilityRepositoryError(
				"SecretStorage could not commit feed capabilities.",
			);
		}

		const newManifestSlot = inactiveSlot(
			current.status === "available" ? current.value.manifestSlot : undefined,
		);
		const overwrittenManifest = this.readManifest(reference, newManifestSlot, envelope.feedId);
		if (overwrittenManifest.status === "unavailable") {
			throw new FeedCapabilityRepositoryError("SecretStorage is unavailable.");
		}
		if (overwrittenManifest.status === "invalid") {
			throw new FeedCapabilityRepositoryError("Stored feed capabilities are invalid.");
		}
		let plannedPages: Array<{ key: string; serialized: string }>;
		let descriptors: FeedCapabilityPageDescriptor[];
		let newManifestKey: string;
		try {
			plannedPages = preparedPages.map((prepared) => {
				const validated = validatePage(
					prepared.page,
					envelope.feedId,
					generation,
					prepared.page.index,
					prepared.page.bucket,
				);
				if (
					!validated ||
					JSON.stringify(validated) !== prepared.serialized ||
					serializedByteLength(prepared.serialized) > MAX_SECRET_STORAGE_ITEM_BYTES
				) {
					throw new Error("Invalid physical page plan");
				}
				return {
					key: pageKey(reference, prepared.page.index, newManifestSlot),
					serialized: prepared.serialized,
				};
			});
			descriptors = preparedPages.map((prepared) => ({
				index: prepared.page.index,
				bucket: prepared.page.bucket,
				slot: newManifestSlot,
				digest: prepared.digest,
				byteLength: prepared.byteLength,
				episodeCount: prepared.episodeCount,
			}));
			newManifestKey = manifestKey(reference, newManifestSlot);
		} catch {
			throw new FeedCapabilityRepositoryError(
				"SecretStorage could not commit feed capabilities.",
			);
		}

		const manifest = makeManifest(envelope, generation, contentDigest, descriptors);
		const serializedManifest = serializePhysicalItem(manifest);
		if (!serializedManifest || !this.validatePhysicalManifest(manifest, envelope.feedId)) {
			throw new FeedCapabilityRepositoryError(
				"SecretStorage could not commit feed capabilities.",
			);
		}

		const writtenPageKeys: string[] = [];
		try {
			for (const page of plannedPages) {
				this.writeExact(page.key, page.serialized);
				writtenPageKeys.push(page.key);
			}
		} catch {
			this.blankBestEffort(writtenPageKeys);
			throw new FeedCapabilityRepositoryError(
				"SecretStorage could not commit feed capabilities.",
			);
		}

		try {
			this.writeExact(newManifestKey, serializedManifest);
		} catch {
			this.blankBestEffort([newManifestKey, ...writtenPageKeys]);
			throw new FeedCapabilityRepositoryError(
				"SecretStorage could not commit feed capabilities.",
			);
		}

		const selected = await this.loadGeneration(envelope.feedId, reference);
		if (
			selected.status !== "available" ||
			selected.value.manifest.generation !== generation ||
			selected.value.manifest.contentDigest !== contentDigest
		) {
			this.blankBestEffort([newManifestKey, ...writtenPageKeys]);
			throw new FeedCapabilityRepositoryError(
				"SecretStorage could not commit feed capabilities.",
			);
		}

		if (overwrittenManifest.status === "available") {
			const selectedPageKeys = new Set(
				descriptors.map((descriptor) =>
					pageKey(reference, descriptor.index, descriptor.slot),
				),
			);
			const supersededPageKeys = overwrittenManifest.value.manifest.pages
				.map((descriptor) => pageKey(reference, descriptor.index, descriptor.slot))
				.filter((key) => !selectedPageKeys.has(key));
			this.blankBestEffort(supersededPageKeys);
		}

		return reference;
	}

	private async withFeedCommit<T>(feedId: FeedHandle, operation: () => Promise<T>): Promise<T> {
		let release!: () => void;
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		const previous = this.commitQueues.get(feedId);
		this.commitQueues.set(feedId, current);
		if (previous) await previous;

		try {
			return await operation();
		} finally {
			release();
			if (this.commitQueues.get(feedId) === current) this.commitQueues.delete(feedId);
		}
	}

	async getFeedCapabilities(
		feedId: FeedHandle | string,
		reference: unknown,
	): Promise<FeedCapabilityEnvelope | null> {
		const result = await this.readFeedCapabilities(feedId, reference);
		return result.status === "available" ? result.value : null;
	}

	async feedCapabilitiesStatus(
		feedId: FeedHandle | string,
		reference: unknown,
	): Promise<CapabilityStatus> {
		return (await this.readFeedCapabilities(feedId, reference)).status;
	}

	async getEpisodeResources(
		feedId: FeedHandle | string,
		episodeId: EpisodeHandle | string,
		reference: unknown,
	): Promise<EpisodeResourcesEnvelope | null> {
		const result = await this.readEpisodeResources(feedId, episodeId, reference);
		return result.status === "available" ? result.value : null;
	}

	async episodeResourcesStatus(
		feedId: FeedHandle | string,
		episodeId: EpisodeHandle | string,
		reference: unknown,
	): Promise<CapabilityStatus> {
		return (await this.readEpisodeResources(feedId, episodeId, reference)).status;
	}

	private async allocateNamespace(feedId: FeedHandle): Promise<FeedCapabilityReference> {
		const marker = markerFor(feedId);
		const serializedMarker = serializePhysicalItem(marker);
		if (!serializedMarker) {
			throw new FeedCapabilityRepositoryError("Invalid feed capability namespace.");
		}

		for (let attempt = 1; attempt <= MAX_FEED_CAPABILITY_REFERENCE_ATTEMPTS; attempt += 1) {
			const reference = feedCapabilityReferenceForAttempt(feedId, attempt);
			if (!reference) {
				throw new FeedCapabilityRepositoryError("Invalid feed capability binding.");
			}
			let existing: string | null;
			try {
				existing = this.storage.getSecret(reference);
			} catch {
				throw new FeedCapabilityRepositoryError("SecretStorage is unavailable.");
			}

			if (existing === null) {
				try {
					this.writeExact(reference, serializedMarker);
				} catch {
					throw new FeedCapabilityRepositoryError(
						"SecretStorage could not reserve a feed capability namespace.",
					);
				}
				return reference;
			}

			const decoded = parseBoundedItem(existing, (candidate) =>
				validateNamespaceMarker(candidate, feedId),
			);
			if (decoded) return reference;
		}

		throw new FeedCapabilityRepositoryError(
			"Could not allocate a SecretStorage namespace for feed capabilities.",
		);
	}

	async readFeedCapabilities(
		feedId: FeedHandle | string,
		reference: unknown,
	): Promise<CapabilityReadResult<FeedCapabilityEnvelope>> {
		if (!isFeedCapabilityReferenceFor(feedId, reference)) return { status: "invalid" };
		const generation = await this.loadGeneration(feedId, reference);
		return generation.status === "available"
			? { status: "available", value: generation.value.bundle }
			: generation;
	}

	async readEpisodeResources(
		feedId: FeedHandle | string,
		episodeId: EpisodeHandle | string,
		reference: unknown,
	): Promise<CapabilityReadResult<EpisodeResourcesEnvelope>> {
		if (!isEpisodeHandle(episodeId)) return { status: "invalid" };
		const bundle = await this.readFeedCapabilities(feedId, reference);
		if (bundle.status !== "available") return bundle;
		const entry = bundle.value.episodeResources[episodeId];
		return entry ? { status: "available", value: entry } : { status: "missing" };
	}

	private async loadGeneration(
		feedId: unknown,
		reference: FeedCapabilityReference | string,
	): Promise<ReadResult<LoadedGeneration>> {
		if (!isFeedCapabilityReferenceFor(feedId, reference)) return { status: "invalid" };

		const markerRead = this.readSecret(reference);
		if (markerRead.status !== "available") return markerRead;
		const marker = parseBoundedItem(markerRead.value, (candidate) =>
			validateNamespaceMarker(candidate, feedId),
		);
		if (!marker) return { status: "invalid" };

		const left = this.readManifest(reference, "a", feedId);
		const right = this.readManifest(reference, "b", feedId);
		if (left.status === "unavailable" || right.status === "unavailable") {
			return { status: "unavailable" };
		}
		if (left.status === "invalid" || right.status === "invalid") {
			return { status: "invalid" };
		}
		if (left.status === "missing" && right.status === "missing") {
			return { status: "missing" };
		}

		let selected: LoadedManifestSlot;
		if (left.status === "available" && right.status === "available") {
			if (left.value.manifest.generation === right.value.manifest.generation) {
				if (manifestsDiverge(left.value, right.value)) return { status: "invalid" };
				selected = left.value;
			} else {
				selected =
					left.value.manifest.generation > right.value.manifest.generation
						? left.value
						: right.value;
			}
		} else if (left.status === "available") {
			selected = left.value;
		} else if (right.status === "available") {
			selected = right.value;
		} else {
			return { status: "missing" };
		}

		return this.loadManifestPages(reference, selected);
	}

	private readManifest(
		reference: string,
		slot: PhysicalSlot,
		feedId: unknown,
	): ReadResult<LoadedManifestSlot> {
		const read = this.readSecret(manifestKey(reference, slot), true);
		if (read.status !== "available") return read;
		const manifest = parseBoundedItem(read.value, (candidate) =>
			validateManifest(candidate, feedId),
		);
		if (manifest?.pages.some((page) => page.slot !== slot)) return { status: "invalid" };
		return manifest
			? { status: "available", value: { manifest, serialized: read.value, slot } }
			: { status: "invalid" };
	}

	private async loadManifestPages(
		reference: string,
		selected: LoadedManifestSlot,
	): Promise<ReadResult<LoadedGeneration>> {
		const captured: Array<{ page: FeedCapabilityPage; serialized: string; digest: string }> =
			[];
		for (const descriptor of selected.manifest.pages) {
			const read = this.readSecret(
				pageKey(reference, descriptor.index, descriptor.slot),
				true,
			);
			if (read.status === "unavailable") return read;
			if (read.status !== "available") return { status: "invalid" };
			if (
				serializedByteLength(read.value) !== descriptor.byteLength ||
				descriptor.byteLength > MAX_SECRET_STORAGE_ITEM_BYTES
			) {
				return { status: "invalid" };
			}
			const page = parseBoundedItem(read.value, (candidate) =>
				validatePage(
					candidate,
					selected.manifest.feedId,
					selected.manifest.generation,
					descriptor.index,
					descriptor.bucket,
				),
			);
			if (!page || Object.keys(page.episodeResources).length !== descriptor.episodeCount) {
				return { status: "invalid" };
			}
			captured.push({ page, serialized: read.value, digest: descriptor.digest });
		}

		try {
			const digests = await Promise.all(captured.map((item) => sha256Hex(item.serialized)));
			if (digests.some((digest, index) => digest !== captured[index].digest)) {
				return { status: "invalid" };
			}
		} catch {
			return { status: "unavailable" };
		}

		const pages = captured.map((item) => item.page);
		const bundle = reconstructEnvelope(selected.manifest, pages);
		if (!bundle) return { status: "invalid" };
		try {
			if ((await sha256Hex(JSON.stringify(bundle))) !== selected.manifest.contentDigest) {
				return { status: "invalid" };
			}
		} catch {
			return { status: "unavailable" };
		}
		return {
			status: "available",
			value: { bundle, manifest: selected.manifest, manifestSlot: selected.slot },
		};
	}

	private readSecret(id: string, blankIsMissing = false): ReadResult<string> {
		let value: string | null;
		try {
			value = this.storage.getSecret(id);
		} catch {
			return { status: "unavailable" };
		}
		if (value === null || (blankIsMissing && value === "")) return { status: "missing" };
		return { status: "available", value };
	}

	private writeExact(id: string, serialized: string): void {
		if (serializedByteLength(serialized) > MAX_SECRET_STORAGE_ITEM_BYTES) {
			throw new Error("Physical item exceeds limit");
		}
		try {
			this.storage.setSecret(id, serialized);
		} catch (error) {
			try {
				if (this.storage.getSecret(id) === serialized) return;
			} catch {
				// Exact readback remains the commit authority after an ambiguous write.
			}
			throw error;
		}
		if (this.storage.getSecret(id) !== serialized)
			throw new Error("Physical item readback failed");
	}

	private blankBestEffort(ids: readonly string[]): void {
		for (const id of ids) {
			try {
				this.storage.setSecret(id, "");
				this.storage.getSecret(id);
			} catch {
				// The committed generation does not reference these inactive slots.
			}
		}
	}
}
