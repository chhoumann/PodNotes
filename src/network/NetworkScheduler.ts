import {
	createNetworkResourceLabel,
	NetworkDeadlineError,
	NetworkDisposedError,
	NetworkInvariantError,
	NetworkOperationError,
	NetworkQueueFullError,
	type NetworkResourceLabel,
} from "./NetworkErrors";

export const NETWORK_LANES = Object.freeze(["metadata", "media", "provider"] as const);
export type NetworkLane = (typeof NETWORK_LANES)[number];

export interface NetworkLaneLimit {
	readonly maxActive: number;
	readonly maxQueued: number;
}

export type NetworkLaneLimits = Readonly<Record<NetworkLane, NetworkLaneLimit>>;

export const DEFAULT_NETWORK_LANE_LIMITS: NetworkLaneLimits = Object.freeze({
	metadata: Object.freeze({ maxActive: 4, maxQueued: 512 }),
	media: Object.freeze({ maxActive: 2, maxQueued: 32 }),
	provider: Object.freeze({ maxActive: 2, maxQueued: 16 }),
});

/** The largest delay that browsers and Node schedule without 32-bit overflow. */
export const MAX_NETWORK_DEADLINE_MS = 2_147_483_647;

export interface NetworkClock {
	now(): number;
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface NetworkSchedulerOptions {
	readonly clock?: NetworkClock;
	readonly laneLimits?: Partial<Record<NetworkLane, Partial<NetworkLaneLimit>>>;
}

export interface NetworkTask<T> {
	readonly lane: NetworkLane;
	readonly resourceLabel: NetworkResourceLabel;
	readonly timeoutMs: number;
	readonly operation: (signal: AbortSignal) => T | PromiseLike<T>;
}

export interface NetworkLaneSnapshot {
	readonly active: number;
	readonly queued: number;
	readonly maxActive: number;
	readonly maxQueued: number;
	readonly failed: boolean;
}

export type NetworkSchedulerSnapshot = Readonly<Record<NetworkLane, NetworkLaneSnapshot>>;

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

interface SessionState {
	disposed: boolean;
	readonly activeJobs: Set<ScheduledJob>;
}

interface PreparedTask {
	readonly lane: NetworkLane;
	readonly resourceLabel: NetworkResourceLabel;
	readonly timeoutMs: number;
	readonly operation: (signal: AbortSignal) => unknown | PromiseLike<unknown>;
}

interface ScheduledJob {
	readonly owner: SessionState;
	readonly task: PreparedTask;
	readonly deferred: Deferred<unknown>;
	readonly deadlineAt: number;
	callerSettled: boolean;
	deadlineTimerArmed: boolean;
	permitState: "none" | "held" | "released";
	deadlineTimer?: unknown;
	abortController?: AbortController;
}

interface LaneState {
	active: number;
	failed: boolean;
	readonly activeJobs: Set<ScheduledJob>;
	readonly queue: ScheduledJob[];
	readonly limit: NetworkLaneLimit;
}

type NetworkLaneLimitOverrides = Partial<Record<NetworkLane, Partial<NetworkLaneLimit>>>;

const defaultClock: NetworkClock = {
	now: () => performance.now(),
	setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimeout: (handle) => window.clearTimeout(handle as number),
};

const OWN = Object.prototype.hasOwnProperty;
const NETWORK_LANE_MEMBERSHIP = Object.freeze({
	metadata: true,
	media: true,
	provider: true,
});

/**
 * A shared, transport-independent capacity scheduler. Construct exactly one for
 * a plugin generation and create one session per lifecycle owner. Disposing a
 * session cannot reset permits still held by another session or by an adapter
 * that ignored cancellation.
 */
export class NetworkScheduler {
	private readonly clock: NetworkClock;
	private readonly lanes: Record<NetworkLane, LaneState>;

	constructor(options: NetworkSchedulerOptions = {}) {
		const { clock, laneLimits } = snapshotSchedulerOptions(options);
		this.clock = snapshotClock(clock ?? defaultClock);
		this.lanes = {
			metadata: createLaneState("metadata", laneLimits),
			media: createLaneState("media", laneLimits),
			provider: createLaneState("provider", laneLimits),
		};
	}

	createSession(): NetworkSchedulerSession {
		return new NetworkSchedulerSession(this, {
			disposed: false,
			activeJobs: new Set(),
		});
	}

	getLaneSnapshot(lane: NetworkLane): NetworkLaneSnapshot {
		const laneName = validateLane(lane);
		const state = this.lanes[laneName];
		return Object.freeze({
			active: state.active,
			queued: state.queue.length,
			maxActive: state.limit.maxActive,
			maxQueued: state.limit.maxQueued,
			failed: state.failed,
		});
	}

	getSnapshot(): NetworkSchedulerSnapshot {
		return Object.freeze({
			metadata: this.getLaneSnapshot("metadata"),
			media: this.getLaneSnapshot("media"),
			provider: this.getLaneSnapshot("provider"),
		});
	}

	/** @internal Called only by sessions created by this scheduler. */
	schedule<T>(owner: SessionState, options: NetworkTask<T>): Promise<T> {
		let task: PreparedTask;
		try {
			task = prepareTask(options);
		} catch (error) {
			return Promise.reject(error);
		}

		if (owner.disposed) {
			return Promise.reject(new NetworkDisposedError(task.resourceLabel));
		}

		const lane = this.lanes[task.lane];
		if (lane.failed) {
			return Promise.reject(new NetworkInvariantError(task.resourceLabel));
		}
		if (lane.active >= lane.limit.maxActive && lane.queue.length >= lane.limit.maxQueued) {
			return Promise.reject(new NetworkQueueFullError(task.resourceLabel));
		}

		let now: number;
		try {
			now = readClock(this.clock);
		} catch {
			return Promise.reject(new NetworkInvariantError(task.resourceLabel));
		}

		const job: ScheduledJob = {
			owner,
			task,
			deferred: createDeferred(),
			deadlineAt: now + task.timeoutMs,
			callerSettled: false,
			deadlineTimerArmed: false,
			permitState: "none",
		};
		if (!this.armDeadline(job, task.timeoutMs)) {
			this.failLane(job);
			return job.deferred.promise as Promise<T>;
		}

		if (lane.active < lane.limit.maxActive) {
			this.start(job);
		} else {
			lane.queue.push(job);
		}

		return job.deferred.promise as Promise<T>;
	}

	/** @internal Called only by sessions created by this scheduler. */
	disposeSession(owner: SessionState): void {
		if (owner.disposed) return;
		owner.disposed = true;

		for (const lane of Object.values(this.lanes)) {
			for (let index = lane.queue.length - 1; index >= 0; index -= 1) {
				const job = lane.queue[index];
				if (job.owner !== owner) continue;
				lane.queue.splice(index, 1);
				this.rejectCaller(job, new NetworkDisposedError(job.task.resourceLabel));
			}
		}

		for (const job of owner.activeJobs) {
			this.abort(job);
			this.rejectCaller(job, new NetworkDisposedError(job.task.resourceLabel));
		}
	}

	private start(job: ScheduledJob): void {
		if (job.owner.disposed) {
			this.rejectCaller(job, new NetworkDisposedError(job.task.resourceLabel));
			return;
		}
		const lane = this.lanes[job.task.lane];
		if (lane.failed) {
			this.rejectCaller(job, new NetworkInvariantError(job.task.resourceLabel));
			return;
		}

		let now: number;
		try {
			now = readClock(this.clock);
		} catch {
			this.failLane(job);
			return;
		}
		if (now >= job.deadlineAt) {
			this.expire(job);
			return;
		}

		lane.active += 1;
		job.owner.activeJobs.add(job);
		lane.activeJobs.add(job);
		job.permitState = "held";
		job.abortController = new AbortController();

		let adapterPromise: Promise<unknown>;
		try {
			adapterPromise = Promise.resolve(job.task.operation(job.abortController.signal));
		} catch {
			adapterPromise = Promise.reject();
		}

		void adapterPromise
			.then(
				(value) => this.complete(job, value),
				() => this.fail(job),
			)
			.finally(() => this.release(job))
			.catch(() => this.failLane(job));
	}

	private complete(job: ScheduledJob, value: unknown): void {
		if (job.callerSettled) return;
		let now: number;
		try {
			now = readClock(this.clock);
		} catch {
			this.failLane(job);
			return;
		}
		if (now >= job.deadlineAt) {
			this.expire(job);
			return;
		}
		this.resolveCaller(job, value);
	}

	private fail(job: ScheduledJob): void {
		if (job.callerSettled) return;
		let now: number;
		try {
			now = readClock(this.clock);
		} catch {
			this.failLane(job);
			return;
		}
		if (now >= job.deadlineAt) {
			this.expire(job);
			return;
		}
		this.rejectCaller(job, new NetworkOperationError(job.task.resourceLabel));
	}

	private expire(job: ScheduledJob): void {
		if (job.callerSettled) return;

		let now: number;
		try {
			now = readClock(this.clock);
		} catch {
			this.failLane(job);
			return;
		}
		if (now < job.deadlineAt) {
			if (!this.armDeadline(job, job.deadlineAt - now)) {
				this.failLane(job);
			}
			return;
		}

		this.removeQueuedOrAbort(job);
		this.rejectCaller(job, new NetworkDeadlineError(job.task.resourceLabel));
	}

	private release(job: ScheduledJob): void {
		const lane = this.lanes[job.task.lane];
		if (lane.failed) {
			this.releaseFailedLanePermit(job);
			return;
		}
		if (
			job.permitState !== "held" ||
			!job.owner.activeJobs.has(job) ||
			!lane.activeJobs.has(job) ||
			lane.active <= 0
		) {
			this.failLane(job);
			return;
		}
		job.owner.activeJobs.delete(job);
		lane.activeJobs.delete(job);
		job.permitState = "released";
		lane.active -= 1;
		this.clearDeadline(job);
		this.drain(job.task.lane);
	}

	private drain(laneName: NetworkLane): void {
		const lane = this.lanes[laneName];
		while (!lane.failed && lane.active < lane.limit.maxActive && lane.queue.length > 0) {
			const next = lane.queue.shift();
			if (next) this.start(next);
		}
	}

	private armDeadline(job: ScheduledJob, delayMs: number): boolean {
		this.clearDeadline(job);
		try {
			job.deadlineTimer = this.clock.setTimeout(
				() => this.expire(job),
				Math.min(MAX_NETWORK_DEADLINE_MS, Math.max(0, delayMs)),
			);
			job.deadlineTimerArmed = true;
			return true;
		} catch {
			job.deadlineTimer = undefined;
			job.deadlineTimerArmed = false;
			return false;
		}
	}

	private clearDeadline(job: ScheduledJob): void {
		if (!job.deadlineTimerArmed) return;
		const handle = job.deadlineTimer;
		job.deadlineTimerArmed = false;
		job.deadlineTimer = undefined;
		try {
			this.clock.clearTimeout(handle);
		} catch {
			// Timer cleanup failure cannot strand or re-settle the caller.
		}
	}

	private abort(job: ScheduledJob): void {
		if (!job.abortController || job.abortController.signal.aborted) return;
		job.abortController.abort();
	}

	private resolveCaller(job: ScheduledJob, value: unknown): void {
		if (job.callerSettled) return;
		job.callerSettled = true;
		this.clearDeadline(job);
		job.deferred.resolve(value);
	}

	private rejectCaller(job: ScheduledJob, error: unknown): void {
		if (job.callerSettled) return;
		job.callerSettled = true;
		this.clearDeadline(job);
		job.deferred.reject(error);
	}

	private removeQueuedOrAbort(job: ScheduledJob): void {
		if (job.abortController) {
			this.abort(job);
			return;
		}
		const queue = this.lanes[job.task.lane].queue;
		const queueIndex = queue.indexOf(job);
		if (queueIndex !== -1) queue.splice(queueIndex, 1);
	}

	private failLane(job: ScheduledJob): void {
		try {
			const lane = this.lanes[job.task.lane];
			lane.failed = true;
			for (const active of lane.activeJobs) {
				this.abort(active);
				this.rejectCaller(active, new NetworkInvariantError(active.task.resourceLabel));
				this.clearDeadline(active);
			}
			for (const queued of lane.queue.splice(0)) {
				this.rejectCaller(queued, new NetworkInvariantError(queued.task.resourceLabel));
			}
			this.rejectCaller(job, new NetworkInvariantError(job.task.resourceLabel));
			this.clearDeadline(job);
		} catch {
			// The lane remains failed and the terminal promise chain stays observed.
		}
	}

	private releaseFailedLanePermit(job: ScheduledJob): void {
		if (job.permitState !== "held") return;
		job.permitState = "released";
		job.owner.activeJobs.delete(job);
		const lane = this.lanes[job.task.lane];
		lane.activeJobs.delete(job);
		if (lane.active > 0) lane.active -= 1;
		this.clearDeadline(job);
	}
}

export class NetworkSchedulerSession {
	constructor(
		private readonly scheduler: NetworkScheduler,
		private readonly state: SessionState,
	) {}

	schedule<T>(task: NetworkTask<T>): Promise<T> {
		return this.scheduler.schedule(this.state, task);
	}

	dispose(): void {
		this.scheduler.disposeSession(this.state);
	}

	isDisposed(): boolean {
		return this.state.disposed;
	}

	getLaneSnapshot(lane: NetworkLane): NetworkLaneSnapshot {
		return this.scheduler.getLaneSnapshot(lane);
	}

	getSnapshot(): NetworkSchedulerSnapshot {
		return this.scheduler.getSnapshot();
	}
}

function prepareTask<T>(options: NetworkTask<T>): PreparedTask {
	try {
		const record = strictPlainDataRecord(options, [
			"lane",
			"resourceLabel",
			"timeoutMs",
			"operation",
		]);
		for (const property of ["lane", "resourceLabel", "timeoutMs", "operation"] as const) {
			if (!OWN.call(record, property)) throw new Error();
		}

		const lane = validateLane(record.lane);
		const resourceLabel = createNetworkResourceLabel(record.resourceLabel as string);
		const timeoutMs = record.timeoutMs;
		if (
			!Number.isSafeInteger(timeoutMs) ||
			(timeoutMs as number) <= 0 ||
			(timeoutMs as number) > MAX_NETWORK_DEADLINE_MS
		) {
			throw new Error();
		}
		const operation = record.operation;
		if (typeof operation !== "function") throw new Error();

		return Object.freeze({
			lane,
			resourceLabel,
			timeoutMs: timeoutMs as number,
			operation: operation as (signal: AbortSignal) => unknown | PromiseLike<unknown>,
		});
	} catch {
		throw new TypeError("Network task is invalid.");
	}
}

function createLaneState(lane: NetworkLane, overrides: NetworkLaneLimitOverrides): LaneState {
	const defaults = DEFAULT_NETWORK_LANE_LIMITS[lane];
	const override = overrides[lane];
	const maxActive =
		override && OWN.call(override, "maxActive") ? override.maxActive : defaults.maxActive;
	const maxQueued =
		override && OWN.call(override, "maxQueued") ? override.maxQueued : defaults.maxQueued;

	validatePositiveInteger(maxActive, `${lane}.maxActive`);
	validateNonNegativeInteger(maxQueued, `${lane}.maxQueued`);

	return {
		active: 0,
		failed: false,
		activeJobs: new Set(),
		queue: [],
		limit: Object.freeze({ maxActive, maxQueued }),
	};
}

function snapshotSchedulerOptions(options: unknown): {
	readonly clock?: NetworkClock;
	readonly laneLimits: NetworkLaneLimitOverrides;
} {
	try {
		const record = strictPlainDataRecord(options, ["clock", "laneLimits"]);
		const clock = OWN.call(record, "clock") ? record.clock : undefined;
		const laneLimits = snapshotLaneLimitOverrides(
			OWN.call(record, "laneLimits") ? record.laneLimits : undefined,
		);
		return Object.freeze({
			...(clock === undefined ? {} : { clock: clock as NetworkClock }),
			laneLimits,
		});
	} catch {
		throw new TypeError("Network scheduler options are invalid.");
	}
}

function snapshotLaneLimitOverrides(value: unknown): NetworkLaneLimitOverrides {
	if (value === undefined) return Object.freeze({});
	const record = strictPlainDataRecord(value, NETWORK_LANES);
	const snapshot: Partial<Record<NetworkLane, Partial<NetworkLaneLimit>>> = {};
	for (const lane of NETWORK_LANES) {
		if (!OWN.call(record, lane)) continue;
		const limit = strictPlainDataRecord(record[lane], ["maxActive", "maxQueued"]);
		const copied: { maxActive?: number; maxQueued?: number } = {};
		if (OWN.call(limit, "maxActive")) copied.maxActive = limit.maxActive as number;
		if (OWN.call(limit, "maxQueued")) copied.maxQueued = limit.maxQueued as number;
		snapshot[lane] = Object.freeze(copied);
	}
	return Object.freeze(snapshot);
}

function strictPlainDataRecord(
	value: unknown,
	allowedKeys: readonly string[],
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error();
	const record = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !allowedKeys.includes(key)) throw new Error();
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error();
		record[key] = descriptor.value;
	}
	return record;
}

function validateLane(value: unknown): NetworkLane {
	if (typeof value !== "string" || !OWN.call(NETWORK_LANE_MEMBERSHIP, value)) {
		throw new TypeError("Network lane must be metadata, media, or provider.");
	}
	return value as NetworkLane;
}

function snapshotClock(clock: NetworkClock): NetworkClock {
	if (
		!clock ||
		typeof clock.now !== "function" ||
		typeof clock.setTimeout !== "function" ||
		typeof clock.clearTimeout !== "function"
	) {
		throw new TypeError("Network scheduler clock is invalid.");
	}

	return Object.freeze({
		now: clock.now.bind(clock),
		setTimeout: clock.setTimeout.bind(clock),
		clearTimeout: clock.clearTimeout.bind(clock),
	});
}

function readClock(clock: NetworkClock): number {
	const now = clock.now();
	if (!Number.isFinite(now)) {
		throw new TypeError("Network scheduler clock returned an invalid time.");
	}
	return now;
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function validatePositiveInteger(value: unknown, name: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new TypeError(`${name} must be a positive integer.`);
	}
}

function validateNonNegativeInteger(value: unknown, name: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new TypeError(`${name} must be a non-negative integer.`);
	}
}
