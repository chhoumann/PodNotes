(async () => {
	const failures = [];
	let plugin;
	for (let i = 0; i < 100; i++) {
		plugin = app.plugins.plugins.podnotes;
		if (plugin?.api && app.commands.commands["podnotes:podnotes-show-leaf"]) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (app.isMobile !== true) failures.push("app.isMobile is not true");
	if (!app.plugins.enabledPlugins.has("podnotes") || !plugin) {
		failures.push("PodNotes is not enabled and loaded");
	}
	const commandAccepted = app.commands.executeCommandById("podnotes:podnotes-show-leaf");
	if (!commandAccepted) failures.push("podnotes:podnotes-show-leaf was not accepted");

	// The drawer animates open, so require the same on-screen box twice in a row.
	let view = null;
	let last = "";
	for (let i = 0; commandAccepted && !view && i < 100; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const rect = document
			.querySelector('.workspace-leaf-content[data-type="podcast_player_view"] .podcast-view')
			?.getBoundingClientRect();
		const visible =
			rect &&
			rect.width > 0 &&
			rect.height > 0 &&
			rect.left < innerWidth &&
			rect.right > 0 &&
			rect.top < innerHeight &&
			rect.bottom > 0;
		const box = visible ? `${rect.left},${rect.top},${rect.width},${rect.height}` : "";
		if (box && box === last) view = { width: rect.width, height: rect.height };
		last = box;
	}
	if (commandAccepted && !view) failures.push("the PodNotes view did not become visible");

	return {
		ok: failures.length === 0,
		failures,
		version: plugin?.manifest.version ?? null,
		view,
	};
})();
