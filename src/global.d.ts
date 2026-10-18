import type { App, EventRef, Vault } from "obsidian";

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
	isMobile?: boolean;
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
		> & {
			quickadd?: {
				api: {
					executeChoice(choice: string, variables: Record<string, string>): Promise<void>;
				};
			};
		};
		requestSaveConfig: () => void;
		updates: Record<string, unknown>;
	};
	setting: {
		open(): void;
		openTabById(id: string): void;
	};
	vault: Vault & {
		/** Not in the public types: any change Obsidian sees to a path, config files included. */
		on(name: "raw", callback: (path: string) => unknown): EventRef;
	};
}

export default App2;

declare global {
	const app: App2;
}

declare module "*.svelte" {
	import type { Component } from "svelte";
	const component: Component;
	export default component;
}
