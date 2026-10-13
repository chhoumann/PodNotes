import { expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import { click, closeSettings, notices, openPodNotesSettings, typeInto } from "./journey/actions";
import { startFixtureServer } from "./journey/fixtures";
import { seedLibrary } from "./journey/library";
import { RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("private-feeds");

test.each(["invalid", "public", "private"])(
	"Enter in Set feed address closes without reopening after a %s address",
	async (kind) => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const show = {
			title: "Private",
			slug: "enter-private",
			query: "?auth=ENTER_SENTINEL",
			artwork: false,
			episodes: [{ title: "Private episode", seconds: 6 }],
		};
		const publicShow = { ...show, slug: "enter-public", query: "" };
		const server = await startFixtureServer([show, publicShow]);
		onTestFinished(() => server.stop());
		await seedLibrary(context, server);
		const id = "podnotes-feed-url-12345678-9abc-4def-8123-456789abcdef";
		await obsidian.dev.evalJson(`app.secretStorage.setSecret(${JSON.stringify(id)}, ""), true`);
		onTestFinished(() =>
			obsidian.dev.evalJson(`app.secretStorage.setSecret(${JSON.stringify(id)}, ""), true`),
		);
		await plugin.updateDataAndReload<Record<string, unknown>>((data) => {
			data.savedFeeds = {
				Private: {
					title: "Private",
					artworkUrl: "",
					url: "podnotes-private-feed:Private",
					urlSecretId: "podnotes-feed-url-12345678-9abc-4def-8123-456789abcdef",
				},
			};
		}, RELOAD_OPTIONS);
		onTestFinished(async () => {
			await obsidian.dev.evalJson(
				'document.querySelectorAll(".modal-container:not(:has(.mod-settings)) .modal-close-button").forEach(el => el.click()), true',
			);
			await closeSettings(obsidian);
		});
		await openPodNotesSettings(obsidian);
		await click(obsidian, {
			name: "Set feed address",
			elements: `[...document.querySelectorAll(${JSON.stringify('button[aria-label="Set feed address for Private"]')})]`,
		});
		await typeInto(
			obsidian,
			{
				name: "Feed address",
				elements:
					'[...document.querySelectorAll(".modal-container:not(:has(.mod-settings)) input")]',
			},
			kind === "invalid"
				? "not an address"
				: server.feedUrl(kind === "private" ? show : publicShow),
		);
		for (const type of ["keyDown", "keyUp"]) {
			await obsidian.exec("dev:cdp", {
				method: "Input.dispatchKeyEvent",
				params: JSON.stringify({
					type,
					key: "Enter",
					code: "Enter",
					windowsVirtualKeyCode: 13,
					text: "\r",
				}),
			});
		}
		if (kind === "private") {
			await obsidian.waitFor(
				() =>
					obsidian.dev.evalJson<boolean>(
						`app.secretStorage.getSecret(${JSON.stringify(id)}) === ${JSON.stringify(server.feedUrl(show))}`,
					),
				{ timeoutMs: 10_000 },
			);
			expect(
				await obsidian.dev.evalJson<string>(
					"app.plugins.plugins.podnotes.settings.savedFeeds.Private.urlSecretId",
				),
			).toBe(id);
		} else {
			expect(await notices(obsidian)).toContain(
				kind === "invalid"
					? "Enter the feed's http or https address."
					: "Enter a private feed address.",
			);
			expect(server.requests()).not.toContain(new URL(server.feedUrl(publicShow)).pathname);
		}
		expect(
			await obsidian.dev.evalJson<number>(
				'document.querySelectorAll(".modal-container:not(:has(.mod-settings))").length',
			),
		).toBe(0);
	},
);
