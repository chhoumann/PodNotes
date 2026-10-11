async (deadline) => {
	const MIN_BYTES = 150 * 1024 * 1024;
	const failures = [];
	const started = Date.now();
	const plugin = app.plugins.plugins.podnotes;
	const episode = plugin?.api.podcast;
	const heap = () => performance.memory?.usedJSHeapSize ?? null;
	const report = (extra) => ({
		ok: failures.length === 0,
		failures,
		episode: episode && {
			title: episode.title,
			podcastName: episode.podcastName,
			feedUrl: episode.feedUrl ?? null,
			streamUrl: episode.streamUrl,
		},
		...extra,
	});
	const registration = async () => {
		const data = JSON.parse(
			await app.vault.adapter.read(`${app.vault.configDir}/plugins/podnotes/data.json`),
		);
		return (data.downloadedEpisodes?.[episode.podcastName] ?? []).find(
			(entry) => entry.title === episode.title,
		);
	};
	const failedNotice = () =>
		[...document.querySelectorAll(".notice")]
			.map((notice) => notice.textContent ?? "")
			.find(
				(text) =>
					text.includes(`Download "${episode.title}"`) &&
					text.includes("Download failed:"),
			);

	if (!episode) {
		failures.push("no episode is loaded in PodNotes; play the episode to download first");
		return report({});
	}
	if (!/^https?:\/\//.test(episode.streamUrl ?? "")) {
		failures.push("the playing episode is not a remote episode");
	} else if (await registration()) {
		failures.push("the episode is already registered as downloaded; pick one that is not");
	}
	if (failures.length) return report({});

	plugin.api.stop();
	const heapBefore = heap();
	if (!app.commands.executeCommandById("podnotes:download-playing-episode")) {
		failures.push("podnotes:download-playing-episode was not accepted");
		return report({});
	}

	let entry;
	let failed;
	while (!entry && !failed && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		entry = await registration();
		failed = failedNotice();
	}
	const seconds = Math.round((Date.now() - started) / 1000);
	if (!entry) {
		failures.push(failed ?? "no download was registered before the deadline");
		return report({ seconds });
	}

	const stat = await app.vault.adapter.stat(entry.filePath);
	const folder = entry.filePath.split("/").slice(0, -1).join("/");
	const partials = (await app.vault.adapter.list(folder)).files.filter((path) =>
		path.endsWith(".podnotes-partial"),
	);
	if (entry.downloadedByPodNotes !== true) {
		failures.push("the registration is not marked downloadedByPodNotes");
	}
	if (stat?.type !== "file" || !Number.isSafeInteger(stat.size) || stat.size !== entry.size) {
		failures.push(`the file has ${stat?.size} bytes but ${entry.size} are registered`);
	}
	if (!Number.isSafeInteger(entry.size) || entry.size < MIN_BYTES) {
		failures.push(
			`the episode has ${entry.size} bytes; this probe needs at least ${MIN_BYTES}`,
		);
	}
	if (partials.length) failures.push(`partial files remain: ${partials.join(", ")}`);

	return report({
		file: { path: entry.filePath, registeredBytes: entry.size, bytes: stat?.size ?? null },
		partials,
		seconds,
		heapBytes: { before: heapBefore, after: heap() },
	});
};
