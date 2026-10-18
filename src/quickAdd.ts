import type { App } from "obsidian";
import type App2 from "./global";

interface QuickAddChoice {
	id: string;
	name: string;
}

/** What PodNotes calls on QuickAdd's API. QuickAdd added all of it with choice picking. */
interface QuickAddApi {
	getChoice(ref: { id: string }): QuickAddChoice | null;
	/** Opens QuickAdd's choice picker. Rejects when the user dismisses it. */
	pickChoice(): Promise<QuickAddChoice>;
	executeChoice(ref: { id: string }, variables: Record<string, string>): Promise<void>;
}

/** QuickAdd's API, or what the user has to do before PodNotes can use it. */
type QuickAdd = { api: QuickAddApi } | { fix: "Install" | "Enable" | "Update" };

/** `pickChoice` arrived with everything else PodNotes calls, so it stands in for a version check. */
export function findQuickAdd(app: App): QuickAdd {
	const { plugins, manifests } = (app as App2).plugins;
	const quickAdd = plugins.quickadd as unknown as { api: Partial<QuickAddApi> } | undefined;
	const api = quickAdd?.api;
	if (typeof api?.pickChoice === "function") return { api: api as QuickAddApi };
	return { fix: quickAdd ? "Update" : manifests.quickadd ? "Enable" : "Install" };
}

export const MISSING_CHOICE =
	"The QuickAdd choice no longer exists. Choose another in PodNotes settings.";
