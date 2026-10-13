async (deadline) => {
	const MIN_BYTES = 150 * 1024 * 1024;
	const MEDIA = ".podnotes-media, .episode-player audio, .episode-player video";
	const failures = [];
	const started = Date.now();
	const plugin = app.plugins.plugins.podnotes;
	const episode = plugin?.api.podcast;
	const media = document.querySelector(MEDIA);
	const heap = () => performance.memory?.usedJSHeapSize ?? null;
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const snapshot = (el) =>
		el && {
			srcAttribute: el.getAttribute("src"),
			src: el.src,
			currentSrc: el.currentSrc,
			currentTime: el.currentTime,
			readyState: el.readyState,
			networkState: el.networkState,
			paused: el.paused,
			error: el.error && { code: el.error.code, message: el.error.message },
		};
	const playback = { before: snapshot(media), errorEvents: [], positionResets: [] };
	const observe = (stage) => {
		playback[stage] = snapshot(media);
		const current = document.querySelector(MEDIA);
		if (current !== media) {
			playback[`${stage}Replacement`] = snapshot(current);
			failures.push(`the media element was replaced by ${stage}`);
		}
	};
	const report = (extra) => ({
		ok: failures.length === 0,
		failures,
		episode: episode && {
			title: episode.title,
			podcastName: episode.podcastName,
			feedUrl: episode.feedUrl ?? null,
			streamUrl: episode.streamUrl,
		},
		playback,
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
	if (!media || media.paused || media.error || !(media.currentTime > 0)) {
		failures.push("no PodNotes media element is playing; play the episode to download first");
	}
	if (failures.length) return report({});

	const onError = () => playback.errorEvents.push(snapshot(media));
	let previousTime = media.currentTime;
	const onTimeUpdate = () => {
		const time = media.currentTime;
		if (time < previousTime - 0.25) {
			playback.positionResets.push({ from: previousTime, to: time });
		}
		previousTime = time;
	};
	media.addEventListener("error", onError);
	media.addEventListener("timeupdate", onTimeUpdate);
	try {
		const heapBefore = heap();
		if (!app.commands.executeCommandById("podnotes:download-playing-episode")) {
			failures.push("podnotes:download-playing-episode was not accepted");
			return report({});
		}

		let entry;
		let failed;
		while (!entry && !failed && Date.now() < deadline) {
			await sleep(1000);
			entry = await registration();
			failed = failedNotice();
		}
		const seconds = Math.round((Date.now() - started) / 1000);
		onTimeUpdate();
		observe("registered");
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

		const until = Date.now() + 20_000;
		while (
			media.currentTime < playback.registered.currentTime + 2 &&
			!media.error &&
			Date.now() < until
		) {
			await sleep(500);
		}
		onTimeUpdate();
		observe("after");
		const { before, registered, after } = playback;
		if (
			[registered, after].some((state) =>
				["srcAttribute", "src", "currentSrc"].some((key) => state[key] !== before[key]),
			)
		) {
			failures.push("the media source changed during the download");
		}
		if (registered.error || after.error || playback.errorEvents.length) {
			failures.push("the media element reported an error");
		}
		if (playback.positionResets.length) {
			failures.push("the playback position went back during the download");
		}
		if (after.paused || !(after.currentTime >= registered.currentTime + 2)) {
			failures.push("playback did not advance 2 s from its position after the download");
		}

		return report({
			file: { path: entry.filePath, registeredBytes: entry.size, bytes: stat?.size ?? null },
			partials,
			seconds,
			heapBytes: { before: heapBefore, after: heap() },
		});
	} finally {
		media.removeEventListener("error", onError);
		media.removeEventListener("timeupdate", onTimeUpdate);
	}
};
