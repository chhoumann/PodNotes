import { describe, expect, it, vi } from "vitest";
import {
	createNetworkResourceLabel,
	NETWORK_ERROR_CODES,
	NetworkDeadlineError,
	NetworkDisposedError,
	NetworkInvariantError,
	NetworkOperationError,
	NetworkQueueFullError,
	type NetworkResourceLabel,
} from "./NetworkErrors";
import {
	DEFAULT_NETWORK_LANE_LIMITS,
	MAX_NETWORK_DEADLINE_MS,
	NetworkScheduler,
	type NetworkClock,
	type NetworkLane,
	type NetworkSchedulerOptions,
	type NetworkTask,
} from "./NetworkScheduler";

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

class ManualClock implements NetworkClock {
	private nextHandle = 1;
	private nowMs = 0;
	private callbacks = new Map<number, { callback: () => void; dueAt: number; delayMs: number }>();

	now(): number {
		return this.nowMs;
	}

	setTimeout(callback: () => void, delayMs: number): number {
		const handle = this.nextHandle;
		this.nextHandle += 1;
		this.callbacks.set(handle, { callback, dueAt: this.nowMs + delayMs, delayMs });
		return handle;
	}

	clearTimeout(handle: unknown): void {
		this.callbacks.delete(handle as number);
	}

	advance(milliseconds: number): void {
		this.nowMs += milliseconds;
	}

	fire(handle: number): void {
		const scheduled = this.callbacks.get(handle);
		this.callbacks.delete(handle);
		scheduled?.callback();
	}

	fireAtDueTime(handle: number): void {
		const scheduled = this.callbacks.get(handle);
		if (!scheduled) return;
		this.nowMs = Math.max(this.nowMs, scheduled.dueAt);
		this.fire(handle);
	}

	pendingHandles(): number[] {
		return [...this.callbacks.keys()];
	}

	pendingDelays(): number[] {
		return [...this.callbacks.values()].map(({ delayMs }) => delayMs);
	}
}

const FEED_LABEL = createNetworkResourceLabel("feed metadata");
const EPISODE_LABEL = createNetworkResourceLabel("episode media");
const PROVIDER_LABEL = createNetworkResourceLabel("provider operation");

function task<T>(
	operation: (signal: AbortSignal) => T | PromiseLike<T>,
	overrides: Partial<Omit<NetworkTask<T>, "operation">> = {},
): NetworkTask<T> {
	return {
		lane: "metadata",
		resourceLabel: FEED_LABEL,
		timeoutMs: 30_000,
		operation,
		...overrides,
	};
}

async function flushScheduler(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("NetworkScheduler construction and validation", () => {
	it("publishes deeply frozen defaults and immutable snapshots", () => {
		expect(Object.isFrozen(DEFAULT_NETWORK_LANE_LIMITS)).toBe(true);
		expect(Object.isFrozen(DEFAULT_NETWORK_LANE_LIMITS.metadata)).toBe(true);

		const scheduler = new NetworkScheduler();
		const snapshot = scheduler.getSnapshot();
		expect(snapshot).toEqual({
			metadata: { active: 0, queued: 0, maxActive: 4, maxQueued: 512, failed: false },
			media: { active: 0, queued: 0, maxActive: 2, maxQueued: 32, failed: false },
			provider: { active: 0, queued: 0, maxActive: 2, maxQueued: 16, failed: false },
		});
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.metadata)).toBe(true);
		expect(() => Object.assign(snapshot.metadata, { maxActive: 99 })).toThrow();
	});

	it("copies injected limits once and never lets later sessions reconfigure them", () => {
		const limits = {
			metadata: { maxActive: 1, maxQueued: 3 },
			media: { maxActive: 5, maxQueued: 7 },
		};
		const scheduler = new NetworkScheduler({ laneLimits: limits });
		const first = scheduler.createSession();

		limits.metadata.maxActive = 100;
		limits.metadata.maxQueued = 100;
		const second = scheduler.createSession();

		expect(first.getLaneSnapshot("metadata")).toEqual({
			active: 0,
			queued: 0,
			maxActive: 1,
			maxQueued: 3,
			failed: false,
		});
		expect(second.getLaneSnapshot("media")).toMatchObject({ maxActive: 5, maxQueued: 7 });
	});

	it("rejects inherited limit entries and inherited fields", () => {
		const inheritedLimits = Object.create({
			metadata: { maxActive: 100, maxQueued: 100 },
		}) as Record<string, unknown>;
		const metadata = Object.create({ maxActive: 99 }) as { maxQueued: number };
		metadata.maxQueued = 1;
		inheritedLimits.media = metadata;

		expect(
			() =>
				new NetworkScheduler({
					laneLimits: inheritedLimits as NetworkSchedulerOptions["laneLimits"],
				}),
		).toThrow("Network scheduler options are invalid");
	});

	it.each([
		{ laneLimits: null },
		{ laneLimits: { metadata: null } },
		{ laneLimits: { metdata: { maxActive: 1 } } },
		{ laneLimits: { metadata: { maxActve: 1 } } },
		{ laneLimits: { metadata: { maxActive: undefined } } },
		{ unknown: true },
	] as const)("rejects malformed scheduler configuration: %j", (options) => {
		expect(() => new NetworkScheduler(options as unknown as NetworkSchedulerOptions)).toThrow(
			TypeError,
		);
	});

	it.each([
		["maxActive", 0],
		["maxActive", -1],
		["maxActive", 1.5],
		["maxActive", Number.NaN],
		["maxActive", Number.POSITIVE_INFINITY],
		["maxQueued", -1],
		["maxQueued", 1.5],
		["maxQueued", Number.NaN],
		["maxQueued", Number.POSITIVE_INFINITY],
	] as const)("rejects invalid lane limit %s=%s", (field, value) => {
		expect(
			() =>
				new NetworkScheduler({
					laneLimits: { metadata: { [field]: value } },
				}),
		).toThrow(TypeError);
	});

	it.each(["constructor", "toString", "__proto__", "Metadata", ""])(
		"rejects hostile or unknown lane %s",
		async (lane) => {
			const session = new NetworkScheduler().createSession();
			const operation = vi.fn();

			await expect(
				session.schedule(task(operation, { lane: lane as NetworkLane })),
			).rejects.toThrow("Network task is invalid");
			expect(operation).not.toHaveBeenCalled();
			expect(() => session.getLaneSnapshot(lane as NetworkLane)).toThrow(TypeError);
		},
	);

	it("requires task fields to be own properties", async () => {
		const operation = vi.fn();
		const inherited = Object.create({ lane: "metadata" }) as Record<string, unknown>;
		inherited.resourceLabel = FEED_LABEL;
		inherited.timeoutMs = 1_000;
		inherited.operation = operation;
		const session = new NetworkScheduler().createSession();

		await expect(session.schedule(inherited as unknown as NetworkTask<void>)).rejects.toThrow(
			"Network task is invalid",
		);
		expect(operation).not.toHaveBeenCalled();
	});

	it("rejects accessor and proxy task traps without exposing their errors", async () => {
		const sentinel = "https://private.example/feed?token=TASK-SECRET";
		let accessorRead = false;
		const accessorTask = task(() => undefined) as unknown as Record<string, unknown>;
		Object.defineProperty(accessorTask, "lane", {
			enumerable: true,
			get: () => {
				accessorRead = true;
				return "metadata";
			},
		});
		const trappedTask = new Proxy(
			task(() => undefined),
			{
				ownKeys: () => {
					throw new Error(sentinel);
				},
			},
		);
		const session = new NetworkScheduler().createSession();

		for (const hostile of [accessorTask, trappedTask]) {
			const error = await session
				.schedule(hostile as unknown as NetworkTask<void>)
				.catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(TypeError);
			expect(String(error)).toBe("TypeError: Network task is invalid.");
			expect(String(error)).not.toContain(sentinel);
		}
		expect(accessorRead).toBe(false);
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_NETWORK_DEADLINE_MS + 1])(
		"rejects unsafe deadline %s without starting",
		async (timeoutMs) => {
			const operation = vi.fn();
			const session = new NetworkScheduler().createSession();
			await expect(session.schedule(task(operation, { timeoutMs }))).rejects.toThrow(
				TypeError,
			);
			expect(operation).not.toHaveBeenCalled();
		},
	);

	it("accepts the maximum safe timer delay without truncation", async () => {
		const clock = new ManualClock();
		const pending = deferred<void>();
		const session = new NetworkScheduler({ clock }).createSession();
		const scheduled = session.schedule(
			task(() => pending.promise, { timeoutMs: MAX_NETWORK_DEADLINE_MS }),
		);

		expect(clock.pendingDelays()).toEqual([MAX_NETWORK_DEADLINE_MS]);
		session.dispose();
		await expect(scheduled).rejects.toBeInstanceOf(NetworkDisposedError);
		pending.resolve();
		await flushScheduler();
	});

	it("snapshots the injected clock methods", async () => {
		const clock = new ManualClock();
		const originalSetTimeout = clock.setTimeout;
		const scheduler = new NetworkScheduler({ clock });
		clock.setTimeout = vi.fn(() => {
			throw new Error("mutated clock");
		});
		const session = scheduler.createSession();

		await expect(session.schedule(task(() => "ok"))).resolves.toBe("ok");
		expect(clock.setTimeout).not.toHaveBeenCalled();
		expect(originalSetTimeout).not.toBe(clock.setTimeout);
	});

	it("turns timer setup failure into a stable invariant rejection", async () => {
		const operation = vi.fn();
		const clock: NetworkClock = {
			now: () => 0,
			setTimeout: () => {
				throw new Error("timer internals");
			},
			clearTimeout: () => undefined,
		};
		const session = new NetworkScheduler({ clock }).createSession();

		await expect(session.schedule(task(operation))).rejects.toBeInstanceOf(
			NetworkInvariantError,
		);
		expect(operation).not.toHaveBeenCalled();
		expect(session.getLaneSnapshot("metadata")).toMatchObject({
			active: 0,
			queued: 0,
			failed: true,
		});
	});

	it("sanitizes an initial clock-read failure", async () => {
		const sentinel = "https://private.example/feed?token=CLOCK-SECRET";
		const clock: NetworkClock = {
			now: () => {
				throw new Error(sentinel);
			},
			setTimeout: () => 1,
			clearTimeout: () => undefined,
		};
		const session = new NetworkScheduler({ clock }).createSession();
		const error = await session
			.schedule(task(() => undefined))
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NetworkInvariantError);
		expect(String(error)).not.toContain(sentinel);
	});

	it("settles and releases capacity when the clock fails during completion", async () => {
		let reads = 0;
		const clock: NetworkClock = {
			now: () => (++reads <= 2 ? 0 : Number.NaN),
			setTimeout: () => 1,
			clearTimeout: () => undefined,
		};
		const operation = vi.fn(() => "value");
		const session = new NetworkScheduler({ clock }).createSession();

		await expect(session.schedule(task(operation))).rejects.toBeInstanceOf(
			NetworkInvariantError,
		);
		expect(operation).toHaveBeenCalledOnce();
		await flushScheduler();
		expect(session.getLaneSnapshot("metadata")).toMatchObject({
			active: 0,
			queued: 0,
			failed: true,
		});
		await expect(session.schedule(task(() => "must not run"))).rejects.toBeInstanceOf(
			NetworkInvariantError,
		);
	});

	it("fails a lane closed while retaining every permit until its adapter settles", async () => {
		let clockFailed = false;
		const clock: NetworkClock = {
			now: () => (clockFailed ? Number.NaN : 0),
			setTimeout: () => 1,
			clearTimeout: () => undefined,
		};
		const firstGate = deferred<void>();
		const secondGate = deferred<void>();
		const queuedOperation = vi.fn();
		const signals: AbortSignal[] = [];
		const scheduler = new NetworkScheduler({
			clock,
			laneLimits: { metadata: { maxActive: 2, maxQueued: 1 } },
		});
		const firstSession = scheduler.createSession();
		const secondSession = scheduler.createSession();
		const first = firstSession.schedule(
			task((signal) => {
				signals.push(signal);
				return firstGate.promise;
			}),
		);
		const second = secondSession.schedule(
			task((signal) => {
				signals.push(signal);
				return secondGate.promise;
			}),
		);
		const queued = firstSession.schedule(task(queuedOperation));
		const observed = [first, second, queued].map((promise) =>
			promise.catch((error: unknown) => error),
		);

		clockFailed = true;
		firstGate.resolve();
		const errors = await Promise.all(observed);
		expect(errors.every((error) => error instanceof NetworkInvariantError)).toBe(true);
		expect(signals).toHaveLength(2);
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		expect(queuedOperation).not.toHaveBeenCalled();
		await flushScheduler();
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({
			active: 1,
			queued: 0,
			failed: true,
		});

		secondGate.resolve();
		await flushScheduler();
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({
			active: 0,
			queued: 0,
			failed: true,
		});
		await expect(firstSession.schedule(task(() => undefined))).rejects.toBeInstanceOf(
			NetworkInvariantError,
		);
	});

	it("does not strand a caller when timer cleanup throws", async () => {
		const clock: NetworkClock = {
			now: () => 0,
			setTimeout: () => 1,
			clearTimeout: () => {
				throw new Error("timer cleanup internals");
			},
		};
		const session = new NetworkScheduler({ clock }).createSession();

		await expect(session.schedule(task(() => "value"))).resolves.toBe("value");
		await flushScheduler();
		expect(session.getLaneSnapshot("metadata")).toMatchObject({ active: 0, queued: 0 });
	});
});

describe("NetworkScheduler lanes and queueing", () => {
	it("keeps all three lanes independent", async () => {
		const clock = new ManualClock();
		const pending = [deferred<string>(), deferred<string>(), deferred<string>()];
		const started: NetworkLane[] = [];
		const scheduler = new NetworkScheduler({
			clock,
			laneLimits: {
				metadata: { maxActive: 1 },
				media: { maxActive: 1 },
				provider: { maxActive: 1 },
			},
		});
		const session = scheduler.createSession();
		const lanes = ["metadata", "media", "provider"] as const;

		const promises = lanes.map((lane, index) =>
			session.schedule(
				task(
					() => {
						started.push(lane);
						return pending[index].promise;
					},
					{
						lane,
						resourceLabel:
							lane === "metadata"
								? FEED_LABEL
								: lane === "media"
									? EPISODE_LABEL
									: PROVIDER_LABEL,
					},
				),
			),
		);

		expect(started).toEqual(lanes);
		expect(scheduler.getSnapshot()).toMatchObject({
			metadata: { active: 1, queued: 0 },
			media: { active: 1, queued: 0 },
			provider: { active: 1, queued: 0 },
		});
		pending.forEach((entry, index) => entry.resolve(String(index)));
		await Promise.all(promises);
		await flushScheduler();
	});

	it("runs each lane FIFO across sessions", async () => {
		const clock = new ManualClock();
		const scheduler = new NetworkScheduler({
			clock,
			laneLimits: { metadata: { maxActive: 1, maxQueued: 3 } },
		});
		const firstSession = scheduler.createSession();
		const secondSession = scheduler.createSession();
		const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
		const started: number[] = [];
		const operation = (index: number) => () => {
			started.push(index);
			return gates[index].promise;
		};

		const first = firstSession.schedule(task(operation(0)));
		const second = secondSession.schedule(task(operation(1)));
		const third = firstSession.schedule(task(operation(2)));
		expect(started).toEqual([0]);
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({ active: 1, queued: 2 });

		gates[0].resolve(0);
		await first;
		await flushScheduler();
		expect(started).toEqual([0, 1]);
		gates[1].resolve(1);
		await second;
		await flushScheduler();
		expect(started).toEqual([0, 1, 2]);
		gates[2].resolve(2);
		await third;
		await flushScheduler();
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({ active: 0, queued: 0 });
	});

	it("bounds each queue, including a zero-queue lane", async () => {
		const activeGate = deferred<void>();
		const queuedGate = deferred<void>();
		const oneQueued = new NetworkScheduler({
			clock: new ManualClock(),
			laneLimits: { metadata: { maxActive: 1, maxQueued: 1 } },
		}).createSession();
		const active = oneQueued.schedule(task(() => activeGate.promise));
		const queued = oneQueued.schedule(task(() => queuedGate.promise));

		await expect(oneQueued.schedule(task(() => undefined))).rejects.toBeInstanceOf(
			NetworkQueueFullError,
		);
		activeGate.resolve();
		await active;
		await flushScheduler();
		queuedGate.resolve();
		await queued;

		const noQueueGate = deferred<void>();
		const noQueue = new NetworkScheduler({
			clock: new ManualClock(),
			laneLimits: { metadata: { maxActive: 1, maxQueued: 0 } },
		}).createSession();
		const sole = noQueue.schedule(task(() => noQueueGate.promise));
		await expect(noQueue.schedule(task(() => undefined))).rejects.toBeInstanceOf(
			NetworkQueueFullError,
		);
		noQueueGate.resolve();
		await sole;
	});

	it("defensively copies queued task fields before caller mutation", async () => {
		const clock = new ManualClock();
		const scheduler = new NetworkScheduler({
			clock,
			laneLimits: { metadata: { maxActive: 1, maxQueued: 1 } },
		});
		const session = scheduler.createSession();
		const firstGate = deferred<void>();
		const originalOperation = vi.fn(() => "original");
		const replacementOperation = vi.fn(() => "replacement");
		const active = session.schedule(task(() => firstGate.promise, { timeoutMs: 60_000 }));
		const mutableTask: NetworkTask<string> = {
			lane: "metadata",
			resourceLabel: FEED_LABEL,
			timeoutMs: 30_000,
			operation: originalOperation,
		};
		const queued = session.schedule(mutableTask);

		const callerOwned = mutableTask as unknown as {
			lane: NetworkLane;
			resourceLabel: NetworkResourceLabel;
			timeoutMs: number;
			operation: (signal: AbortSignal) => string;
		};
		callerOwned.lane = "media";
		callerOwned.resourceLabel = EPISODE_LABEL;
		callerOwned.timeoutMs = 1;
		callerOwned.operation = replacementOperation;
		firstGate.resolve();
		await active;
		await expect(queued).resolves.toBe("original");
		expect(originalOperation).toHaveBeenCalledOnce();
		expect(replacementOperation).not.toHaveBeenCalled();
		expect(scheduler.getLaneSnapshot("media")).toMatchObject({ active: 0, queued: 0 });
	});
});

describe("NetworkScheduler deadlines and cancellation", () => {
	it("aborts timed-out active work but holds its permit until adapter settlement", async () => {
		const clock = new ManualClock();
		const firstGate = deferred<string>();
		const secondGate = deferred<string>();
		let firstSignal: AbortSignal | undefined;
		const secondOperation = vi.fn(() => secondGate.promise);
		const scheduler = new NetworkScheduler({
			clock,
			laneLimits: { metadata: { maxActive: 1, maxQueued: 1 } },
		});
		const session = scheduler.createSession();
		const timedOut = session.schedule(
			task((signal) => {
				firstSignal = signal;
				return firstGate.promise;
			}),
		);
		const queued = session.schedule(task(secondOperation, { timeoutMs: 60_000 }));
		const [firstDeadline] = clock.pendingHandles();

		clock.fireAtDueTime(firstDeadline);
		await expect(timedOut).rejects.toBeInstanceOf(NetworkDeadlineError);
		expect(firstSignal?.aborted).toBe(true);
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({ active: 1, queued: 1 });
		expect(secondOperation).not.toHaveBeenCalled();

		firstGate.resolve("late");
		await flushScheduler();
		expect(secondOperation).toHaveBeenCalledOnce();
		secondGate.resolve("next");
		await expect(queued).resolves.toBe("next");
		await flushScheduler();
		expect(scheduler.getLaneSnapshot("metadata").active).toBe(0);
	});

	it("removes queued work at its deadline without creating an AbortController", async () => {
		const clock = new ManualClock();
		const activeGate = deferred<void>();
		const queuedOperation = vi.fn();
		const scheduler = new NetworkScheduler({
			clock,
			laneLimits: { metadata: { maxActive: 1, maxQueued: 1 } },
		});
		const session = scheduler.createSession();
		const active = session.schedule(task(() => activeGate.promise, { timeoutMs: 60_000 }));
		const queued = session.schedule(task(queuedOperation));
		const [, queuedDeadline] = clock.pendingHandles();

		clock.fireAtDueTime(queuedDeadline);
		await expect(queued).rejects.toBeInstanceOf(NetworkDeadlineError);
		expect(queuedOperation).not.toHaveBeenCalled();
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({ active: 1, queued: 0 });
		activeGate.resolve();
		await active;
		await flushScheduler();
		expect(queuedOperation).not.toHaveBeenCalled();
	});

	it("checks absolute deadlines when timer delivery is late", async () => {
		const clock = new ManualClock();
		const activeGate = deferred<string>();
		const queuedOperation = vi.fn(() => "must not run");
		let activeSignal: AbortSignal | undefined;
		const scheduler = new NetworkScheduler({
			clock,
			laneLimits: { metadata: { maxActive: 1, maxQueued: 1 } },
		});
		const session = scheduler.createSession();
		const active = session.schedule(
			task((signal) => {
				activeSignal = signal;
				return activeGate.promise;
			}),
		);
		const queued = session.schedule(task(queuedOperation));

		clock.advance(30_001);
		activeGate.resolve("late result");
		await expect(active).rejects.toBeInstanceOf(NetworkDeadlineError);
		await expect(queued).rejects.toBeInstanceOf(NetworkDeadlineError);
		expect(activeSignal?.aborted).toBe(true);
		expect(queuedOperation).not.toHaveBeenCalled();
		await flushScheduler();
		expect(clock.pendingHandles()).toEqual([]);
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({ active: 0, queued: 0 });
	});

	it("re-arms an early timer instead of expiring work early", async () => {
		const clock = new ManualClock();
		const gate = deferred<string>();
		let signal: AbortSignal | undefined;
		const session = new NetworkScheduler({ clock }).createSession();
		const scheduled = session.schedule(
			task((activeSignal) => {
				signal = activeSignal;
				return gate.promise;
			}),
		);
		const [firstTimer] = clock.pendingHandles();

		clock.fire(firstTimer);
		expect(signal?.aborted).toBe(false);
		expect(clock.pendingDelays()).toEqual([30_000]);
		gate.resolve("on time");
		await expect(scheduled).resolves.toBe("on time");
		expect(clock.pendingHandles()).toEqual([]);
	});

	it("makes the deadline win when settlement arrives at the exact boundary", async () => {
		const clock = new ManualClock();
		const gate = deferred<string>();
		let signal: AbortSignal | undefined;
		const session = new NetworkScheduler({ clock }).createSession();
		const scheduled = session.schedule(
			task((activeSignal) => {
				signal = activeSignal;
				return gate.promise;
			}),
		);

		clock.advance(30_000);
		gate.resolve("boundary");
		await expect(scheduled).rejects.toBeInstanceOf(NetworkDeadlineError);
		expect(signal?.aborted).toBe(true);
	});

	it("creates a distinct AbortController for every active operation", async () => {
		const gates = [deferred<void>(), deferred<void>()];
		const signals: AbortSignal[] = [];
		const scheduler = new NetworkScheduler({
			clock: new ManualClock(),
			laneLimits: { metadata: { maxActive: 2 } },
		});
		const session = scheduler.createSession();
		const promises = gates.map((gate) =>
			session.schedule(
				task((signal) => {
					signals.push(signal);
					return gate.promise;
				}),
			),
		);

		expect(signals).toHaveLength(2);
		expect(signals[0]).not.toBe(signals[1]);
		session.dispose();
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		await Promise.all(promises.map((promise) => promise.catch((error: unknown) => error)));
		gates.forEach((gate) => gate.resolve());
		await flushScheduler();
	});

	it("releases one permit exactly once after abort-driven rejection", async () => {
		const clock = new ManualClock();
		const adapter = deferred<void>();
		const scheduler = new NetworkScheduler({
			clock,
			laneLimits: { metadata: { maxActive: 1, maxQueued: 1 } },
		});
		const session = scheduler.createSession();
		const first = session.schedule(
			task((signal) => {
				signal.addEventListener("abort", () => adapter.reject(new Error("aborted")), {
					once: true,
				});
				return adapter.promise;
			}),
		);
		const next = session.schedule(task(() => "next", { timeoutMs: 60_000 }));
		const [deadline] = clock.pendingHandles();

		clock.fireAtDueTime(deadline);
		await expect(first).rejects.toBeInstanceOf(NetworkDeadlineError);
		await expect(next).resolves.toBe("next");
		await flushScheduler();
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({ active: 0, queued: 0 });
	});
});

describe("NetworkScheduler disposal and error boundaries", () => {
	it("disposes only one owner while preserving shared capacity and FIFO", async () => {
		const clock = new ManualClock();
		const oldGate = deferred<void>();
		let oldSignal: AbortSignal | undefined;
		const otherOperation = vi.fn(() => "other");
		const removedOperation = vi.fn(() => "removed");
		const scheduler = new NetworkScheduler({
			clock,
			laneLimits: { metadata: { maxActive: 1, maxQueued: 3 } },
		});
		const oldSession = scheduler.createSession();
		const otherSession = scheduler.createSession();
		const active = oldSession.schedule(
			task((signal) => {
				oldSignal = signal;
				return oldGate.promise;
			}),
		);
		const other = otherSession.schedule(task(otherOperation, { timeoutMs: 60_000 }));
		const removed = oldSession.schedule(task(removedOperation, { timeoutMs: 60_000 }));

		oldSession.dispose();
		oldSession.dispose();
		expect(oldSession.isDisposed()).toBe(true);
		await expect(active).rejects.toBeInstanceOf(NetworkDisposedError);
		await expect(removed).rejects.toBeInstanceOf(NetworkDisposedError);
		expect(oldSignal?.aborted).toBe(true);
		expect(removedOperation).not.toHaveBeenCalled();
		expect(otherOperation).not.toHaveBeenCalled();
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({ active: 1, queued: 1 });
		await expect(oldSession.schedule(task(() => "new"))).rejects.toBeInstanceOf(
			NetworkDisposedError,
		);

		oldGate.resolve();
		await expect(other).resolves.toBe("other");
		expect(otherOperation).toHaveBeenCalledOnce();
		await flushScheduler();
		expect(scheduler.getLaneSnapshot("metadata")).toMatchObject({ active: 0, queued: 0 });
	});

	it.each([
		[
			"sync",
			() => {
				throw new Error("https://secret.example/feed?token=raw response body");
			},
		],
		["async", () => Promise.reject(new Error("provider key sk-secret at https://api.example"))],
	] as const)(
		"sanitizes %s adapter failures without retaining a raw cause",
		async (_kind, operation) => {
			const session = new NetworkScheduler({ clock: new ManualClock() }).createSession();
			const error = await session
				.schedule(task(operation))
				.catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(NetworkOperationError);
			expect(error).toMatchObject({
				code: NETWORK_ERROR_CODES.operationFailed,
				resourceLabel: FEED_LABEL,
			});
			expect(String(error)).toBe(
				`NetworkOperationError: NETWORK_OPERATION_FAILED: ${FEED_LABEL}`,
			);
			expect(JSON.stringify(error)).not.toContain("secret");
			expect(error).not.toHaveProperty("cause");
		},
	);

	it("keeps timeout errors stable after ignored late success and failure", async () => {
		const clock = new ManualClock();
		const gate = deferred<string>();
		const scheduler = new NetworkScheduler({ clock });
		const session = scheduler.createSession();
		const scheduled = session.schedule(task(() => gate.promise));
		const observed = scheduled.catch((error: unknown) => error);
		const [deadline] = clock.pendingHandles();

		clock.fireAtDueTime(deadline);
		const error = await observed;
		expect(error).toBeInstanceOf(NetworkDeadlineError);
		gate.resolve("late secret response");
		await flushScheduler();
		expect(error).toMatchObject({ code: NETWORK_ERROR_CODES.deadlineExceeded });
		expect(scheduler.getLaneSnapshot("metadata").active).toBe(0);
	});
});
