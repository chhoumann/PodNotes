import { normalizePath, type Plugin } from "vite";

export function svelteSizeGuards(): Plugin {
	return {
		name: "podnotes-svelte-size-guards",
		generateBundle(_options, bundle) {
			for (const output of Object.values(bundle)) {
				if (output.type !== "chunk") continue;
				for (const [id, module] of Object.entries(output.modules)) {
					if (
						normalizePath(id).includes("/node_modules/clsx/") &&
						module.renderedLength > 0
					) {
						this.error(
							`${output.fileName} includes clsx (${id}); use class directives or a string template instead of class={expression}.`,
						);
					}
				}
			}
		},
	};
}
