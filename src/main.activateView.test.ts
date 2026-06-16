import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PodNotes from "./main";
import { VIEW_TYPE } from "./constants";

// Regression coverage for #55: "Show PodNotes" / the ribbon icon must reliably
// surface the view. The bug was that the command was gated on the leaf NOT
// existing and never revealed it, so an already-open-but-hidden view (collapsed
// or overflowing sidebar) could not be brought back. activateView reuses the
// existing leaf when present and always reveals it.

function makeLeaf() {
	return {
		setViewState: vi.fn().mockResolvedValue(undefined),
	};
}

function setupPlugin({
	existingLeaves = [] as ReturnType<typeof makeLeaf>[],
	rightLeaf = makeLeaf() as ReturnType<typeof makeLeaf> | null,
} = {}) {
	const workspace = {
		getLeavesOfType: vi.fn().mockReturnValue(existingLeaves),
		getRightLeaf: vi.fn().mockReturnValue(rightLeaf),
		revealLeaf: vi.fn().mockResolvedValue(undefined),
	};

	// Build a bare instance so we exercise activateView without running the full
	// onload() side effects (store wiring, command registration, etc.).
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	(plugin as unknown as { app: { workspace: typeof workspace } }).app = {
		workspace,
	};

	return { plugin, workspace, rightLeaf };
}

describe("PodNotes.activateView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reuses an existing leaf and reveals it without creating a new one", async () => {
		const existing = makeLeaf();
		const { plugin, workspace } = setupPlugin({ existingLeaves: [existing] });

		await plugin.activateView();

		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(existing.setViewState).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledTimes(1);
		expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
	});

	it("creates a right-sidebar leaf when none exists, then reveals it", async () => {
		const { plugin, workspace, rightLeaf } = setupPlugin();

		await plugin.activateView();

		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(rightLeaf?.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE,
			active: true,
		});
		expect(workspace.revealLeaf).toHaveBeenCalledWith(rightLeaf);
	});

	it("does not throw or reveal when no right leaf is available", async () => {
		const { plugin, workspace } = setupPlugin({ rightLeaf: null });

		await expect(plugin.activateView()).resolves.toBeUndefined();
		expect(workspace.revealLeaf).not.toHaveBeenCalled();
	});
});

// Locks the actual #55 wiring (not just activateView's internals): the
// "Show PodNotes" command must stay always-available (a plain callback, never
// a leaf-gated checkCallback) and the ribbon icon must route to activateView.
// A refactor that reintroduced the old checkCallback gate or unwired the ribbon
// would reproduce the bug while activateView's own unit tests stayed green.
describe("PodNotes onload wiring (#55)", () => {
	// onload() wires real module-level stores to controllers; unload them after
	// each test so leaked subscriptions don't fire into a disposed plugin.
	const loaded: PodNotes[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		for (const p of loaded.splice(0)) {
			p.onunload();
		}
		vi.restoreAllMocks();
	});

	async function loadPlugin() {
		const activateSpy = vi
			.spyOn(PodNotes.prototype, "activateView")
			.mockResolvedValue(undefined);

		const commands: Array<Record<string, unknown>> = [];
		const ribbonCalls: Array<{
			icon: string;
			title: string;
			handler: (evt: unknown) => unknown;
		}> = [];

		const plugin = Object.create(PodNotes.prototype) as PodNotes;
		Object.assign(plugin, {
			loadData: vi.fn().mockResolvedValue({}),
			saveData: vi.fn().mockResolvedValue(undefined),
			addCommand: vi.fn((cmd: Record<string, unknown>) => {
				commands.push(cmd);
				return cmd;
			}),
			addRibbonIcon: vi.fn(
				(icon: string, title: string, handler: (evt: unknown) => unknown) => {
					ribbonCalls.push({ icon, title, handler });
					return document.createElement("div");
				},
			),
			addSettingTab: vi.fn(),
			registerView: vi.fn(),
			registerObsidianProtocolHandler: vi.fn(),
			registerEvent: vi.fn(),
			app: {
				workspace: {
					onLayoutReady: vi.fn(),
					on: vi.fn(() => ({})),
					getLeavesOfType: vi.fn(() => []),
					getRightLeaf: vi.fn(() => null),
					revealLeaf: vi.fn(),
					detachLeavesOfType: vi.fn(),
				},
			},
		});

		await plugin.onload();
		loaded.push(plugin);

		return { commands, ribbonCalls, activateSpy };
	}

	it("registers Show PodNotes as an always-available callback, not a leaf-gated checkCallback", async () => {
		const { commands } = await loadPlugin();

		const showCmd = commands.find((c) => c.id === "podnotes-show-leaf");
		expect(showCmd).toBeDefined();
		expect(typeof showCmd?.callback).toBe("function");
		expect(showCmd?.checkCallback).toBeUndefined();
	});

	it("Show PodNotes command and ribbon icon both route to activateView", async () => {
		const { commands, ribbonCalls, activateSpy } = await loadPlugin();

		const showCmd = commands.find((c) => c.id === "podnotes-show-leaf");
		(showCmd?.callback as () => void)();
		expect(activateSpy).toHaveBeenCalledTimes(1);

		const ribbon = ribbonCalls.find((r) => r.title === "Show PodNotes");
		expect(ribbon).toBeDefined();
		expect(ribbon?.icon).toBe("podcast");
		ribbon?.handler(new MouseEvent("click"));
		expect(activateSpy).toHaveBeenCalledTimes(2);
	});
});
