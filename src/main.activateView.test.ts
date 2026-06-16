import { beforeEach, describe, expect, it, vi } from "vitest";
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
