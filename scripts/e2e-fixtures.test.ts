import http from "node:http";
import { expect, it } from "vitest";
import { startFixtureServer } from "../tests/e2e/journey/fixtures";

it("holds a real feed response until release and serves a later refresh independently", async () => {
	const feed = { title: "Held feed", slug: "held", artwork: false, episodes: [] };
	const server = await startFixtureServer([feed]);
	try {
		for (let request = 1; request <= 2; request++) {
			const release = server.holdFeed(feed);
			const url = new URL(server.feedUrl(feed));
			url.hostname = "127.0.0.1";
			let responded = false;
			const body = new Promise<string>((resolve, reject) => {
				http.get(url, (response) => {
					responded = true;
					let text = "";
					response.setEncoding("utf8").on("data", (chunk) => {
						text += chunk;
					});
					response.on("end", () => resolve(text));
				}).on("error", reject);
			});
			await expect.poll(() => server.requests().length).toBe(request);
			expect(responded).toBe(false);
			await release();
			expect(await body).toContain("<title>Held feed</title>");
		}
	} finally {
		await server.stop();
	}
});
