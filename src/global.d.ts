import type { App } from "obsidian";

interface Manifest {
	author: string;
	authorUrl: string;
	description: string;
	dir: string;
	id: string;
	isDesktopOnly: boolean;
	minAppVersion: string;
	name: string;
	version: string;
}

// Not everything is implemented.
interface App2 extends App {
	plugins: {
		app: App;
		enabledPlugins: Set<string>;
		loadingPluginId: string;
		manifests: Record<string, Manifest>;
		plugins: Record<
			string,
			{
				manifest: Manifest;
				app: App;
			}
		>;
		requestSaveConfig: () => void;
		updates: Record<string, unknown>;
		enablePlugin: (id: string) => Promise<void>;
		disablePlugin: (id: string) => Promise<void>;
	};
}

export default App2;

declare global {
	const app: App2;
}
