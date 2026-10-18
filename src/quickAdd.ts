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
	/** Skips a choice whose id QuickAdd already has. */
	importPackage(packageJson: string): Promise<unknown>;
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

export const CAPTURE_CHOICE_ID = "podnotes-capture";

/**
 * QuickAdd's ready-made capture choice. Its format adds no bullet, since the timestamp
 * template starts with one. Settings it leaves out keep a new QuickAdd Capture's defaults.
 */
export const CAPTURE_PACKAGE = JSON.stringify({
	schemaVersion: 1,
	quickAddVersion: "",
	createdAt: "",
	rootChoiceIds: [CAPTURE_CHOICE_ID],
	assets: [],
	choices: [
		{
			parentChoiceId: null,
			pathHint: ["Podcast capture"],
			choice: {
				id: CAPTURE_CHOICE_ID,
				name: "Podcast capture",
				type: "Capture",
				command: false,
				captureTo: "{{VALUE:episodeNote}}",
				createFileIfItDoesntExist: { enabled: true, createWithTemplate: false },
				format: { enabled: true, format: "{{VALUE:timestamp}}" },
				insertAfter: {
					enabled: true,
					after: "## Notes",
					insertAtEnd: true,
					createIfNotFound: true,
					createIfNotFoundLocation: "bottom",
				},
			},
		},
	],
});
