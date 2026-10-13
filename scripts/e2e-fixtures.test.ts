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

it("releases a held feed when its connection closes before the response finishes", async () => {
	const feed = { title: "Aborted feed", slug: "aborted", artwork: false, episodes: [] };
	const server = await startFixtureServer([feed]);
	const release = server.holdFeed(feed);
	const url = new URL(server.feedUrl(feed));
	url.hostname = "127.0.0.1";
	const request = http.get(url);
	request.on("error", () => {});
	try {
		await expect.poll(() => server.requests().length).toBe(1);
		request.destroy();
		await server.stop();
		await release();
	} finally {
		request.destroy();
		await server.stop();
	}
});

it("answers a failing feed with a server error, and the feed again once restored", async () => {
	const feed = { title: "Failing feed", slug: "failing", artwork: false, episodes: [] };
	const server = await startFixtureServer([feed]);
	const url = new URL(server.feedUrl(feed));
	url.hostname = "127.0.0.1";
	const get = () =>
		new Promise<{ status?: number; body: string }>((resolve, reject) => {
			http.get(url, (response) => {
				let body = "";
				response.setEncoding("utf8").on("data", (chunk) => {
					body += chunk;
				});
				response.on("end", () => resolve({ status: response.statusCode, body }));
			}).on("error", reject);
		});
	try {
		const restore = server.failFeed(feed);
		expect(await get()).toEqual({ status: 503, body: "" });
		restore();
		const answered = await get();
		expect(answered.status).toBe(200);
		expect(answered.body).toContain("<title>Failing feed</title>");
		expect(server.requests()).toEqual([url.pathname, url.pathname]);
	} finally {
		await server.stop();
	}
});
