import { vi } from "vitest";

/**
 * `app.plugins` with QuickAdd enabled and holding `choices`, by id to name. Importing a
 * package adds its choices, skipping an id QuickAdd already has, as QuickAdd does.
 */
export function fakeQuickAdd(choices: Record<string, string> = {}) {
	const api = {
		getChoice: ({ id }: { id: string }) => {
			const name = choices[id];
			return name === undefined ? null : { id, name };
		},
		pickChoice: vi.fn<() => Promise<{ id: string; name: string }>>(),
		executeChoice: vi.fn(
			async (_ref: { id: string }, _variables: Record<string, string>) => {},
		),
		importPackage: vi.fn(async (packageJson: string) => {
			const { choices: added } = JSON.parse(packageJson) as {
				choices: { choice: { id: string; name: string } }[];
			};
			for (const { choice } of added) choices[choice.id] ??= choice.name;
		}),
	};
	return {
		api,
		choices,
		plugins: { manifests: { quickadd: {} }, plugins: { quickadd: { api } } },
	};
}

/** `app.plugins` with QuickAdd missing, disabled, or older than choice picking, by the fix each needs. */
export function unusableQuickAdd(fix: "Install" | "Enable" | "Update") {
	const executeChoice = vi.fn(async () => {});
	const plugins = {
		Install: { manifests: {}, plugins: {} },
		Enable: { manifests: { quickadd: {} }, plugins: {} },
		Update: { manifests: { quickadd: {} }, plugins: { quickadd: { api: { executeChoice } } } },
	}[fix];
	return { executeChoice, plugins };
}
