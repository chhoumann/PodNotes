import { mkdir } from "node:fs/promises";
import http from "node:http";
import { resolve } from "node:path";
import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import { closePodNotes, setOffline, showList, showPodNotes } from "./journey/actions";
import { type FixtureFeed, pubDate, startFixtureServer } from "./journey/fixtures";
import { click } from "./journey/input";
import { ageFeedCache, seedLibrary } from "./journey/library";
import { ui } from "./journey/targets";
import { eventually, holdsFor, isDisabled, listedEpisodes, waitUntilShown } from "./journey/wait";
import { jsLiteral, RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("offline-feed-requests");
const evidence = resolve(".obsidian-e2e-artifacts/feed2");

describe("offline feed requests", () => {
	test.each([false, true])("offline reopen and reconnect with held requests %s", async (hold) => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const shows: FixtureFeed[] = ["Alpha", "Beta"].map((title, index) => ({
			title,
			slug: `feed2-${title.toLowerCase()}`,
			artwork: false,
			episodes: [{ title: `${title} cached`, seconds: 6, pubDate: pubDate(index) }],
		}));
		const server = await startFixtureServer(shows);
		const urls = shows.map((show) => server.feedUrl(show));
		const port = Number(new URL(urls[0]).port);
		const bodies = new Map<string, string>();
		for (const url of urls) {
			const local = new URL(url);
			local.hostname = "127.0.0.1";
			bodies.set(
				local.pathname,
				(await (await fetch(local)).text()).replaceAll("cached", "updated"),
			);
		}
		const recovered = http.createServer((request, response) => {
			const body = bodies.get(request.url ?? "");
			response.writeHead(body ? 200 : 404, { "Content-Type": "application/rss+xml" });
			response.end(body);
		});
		onTestFinished(async () => {
			await closePodNotes(obsidian);
			await obsidian.dev.evalJson(`(() => {
				const probe = window.__feed2Requests;
				if (probe) {
					probe.ipc.send = probe.original;
					for (const reply of probe.held) probe.ipc.emit(reply, {}, { status: 503, headers: {}, body: new ArrayBuffer(0) });
				}
				delete window.__feed2Requests;
				return true;
			})()`);
			await setOffline(obsidian, false);
			recovered.closeAllConnections();
			await new Promise<void>((done) => recovered.close(() => done()));
			await server.stop();
		});
		await seedLibrary(context, server, { subscriptions: shows });
		await showPodNotes(obsidian);
		await showList(obsidian, "Latest episodes");
		expect(
			await eventually(obsidian, () => listedEpisodes(obsidian), [
				"Alpha cached",
				"Beta cached",
			]),
		).toEqual(["Alpha cached", "Beta cached"]);
		await closePodNotes(obsidian);
		await ageFeedCache(obsidian, 7 * 60 * 60 * 1000);
		await server.stop();
		await setOffline(obsidian, true);
		await obsidian.dev.evalJson(`(() => {
			const ipc = window.electron.ipcRenderer;
			const original = ipc.send;
			const urls = ${jsLiteral(urls)};
			const probe = { ipc, original, attempts: [], held: [] };
			ipc.send = function(channel, reply, request, ...rest) {
				if (channel === "request-url" && urls.includes(request?.url)) {
					probe.attempts.push({ url: request.url, online: navigator.onLine });
					if (${jsLiteral(hold)} && !navigator.onLine) {
						probe.held.push(reply);
						return;
					}
				}
				return original.call(ipc, channel, reply, request, ...rest);
			};
			window.__feed2Requests = probe;
			return true;
		})()`);
		const attempts = () =>
			obsidian.dev.evalJson<Array<{ url: string; online: boolean }>>(
				"window.__feed2Requests.attempts",
			);
		await plugin.reload(RELOAD_OPTIONS);
		expect(await holdsFor(obsidian, attempts, [], 500)).toEqual([]);
		if (hold) await click(obsidian, ui.ribbonAction("Show PodNotes"));
		else await showPodNotes(obsidian);
		await waitUntilShown(obsidian, ui.offlineStrip);
		await showList(obsidian, "Latest episodes");
		expect(await listedEpisodes(obsidian)).toEqual(["Alpha cached", "Beta cached"]);
		expect(await isDisabled(obsidian, ui.headAction("Refresh all feeds"))).toBe(true);
		const offline = await holdsFor(obsidian, attempts, []);
		console.log(
			"FEED2 offline",
			JSON.stringify({
				hold,
				attempts: offline.length,
				cachedRows: await listedEpisodes(obsidian),
			}),
		);
		expect.soft(offline).toEqual([]);
		await mkdir(evidence, { recursive: true });
		await obsidian.dev.screenshot(resolve(evidence, `offline-${hold}.png`));
		await new Promise<void>((done) => recovered.listen(port, "127.0.0.1", done));
		await setOffline(obsidian, false);
		const refreshed = () =>
			attempts().then((values) =>
				values
					.filter(({ online }) => online)
					.map(({ url }) => url)
					.sort(),
			);
		const online = await eventually(obsidian, refreshed, [...urls].sort());
		console.log("FEED2 reconnect", JSON.stringify({ hold, attempts: online.length }));
		expect.soft(online).toEqual([...urls].sort());
		expect
			.soft(
				await eventually(obsidian, () => listedEpisodes(obsidian), [
					"Alpha updated",
					"Beta updated",
				]),
			)
			.toEqual(["Alpha updated", "Beta updated"]);
		expect(await holdsFor(obsidian, refreshed, [...urls].sort())).toEqual([...urls].sort());
		await obsidian.dev.screenshot(resolve(evidence, `reconnected-${hold}.png`));
	});
});
