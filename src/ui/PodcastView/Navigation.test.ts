import { describe, expect, test } from "vitest";
import { Navigation, type NavState } from "./Navigation";

function recorded(navigation: Navigation): NavState[] {
	const states: NavState[] = [];
	navigation.subscribe((state) => states.push(state));
	states.length = 0;
	return states;
}

describe("Navigation", () => {
	test("Back returns to the previous page where it was scrolled", () => {
		const navigation = new Navigation();
		navigation.rememberScroll(120);
		navigation.go({ kind: "latest" });
		navigation.rememberScroll(40);
		navigation.go({ kind: "feed", key: "Show" });

		expect(navigation.current.scrollTop).toBe(0);
		navigation.back();
		expect(navigation.current).toMatchObject({ page: { kind: "latest" }, scrollTop: 40 });
		navigation.back();
		expect(navigation.current).toEqual({
			page: { kind: "library" },
			stack: [],
			expanded: false,
			scrollTop: 120,
		});
	});

	test("a root clears the pages visited before it", () => {
		const navigation = new Navigation();
		navigation.go({ kind: "feed", key: "Show" });
		navigation.go({ kind: "latest" });

		navigation.goRoot("queue");

		expect(navigation.current).toMatchObject({ page: { kind: "queue" }, stack: [] });
	});

	test("Back from a page nothing led to goes to its parent", () => {
		const navigation = new Navigation();
		navigation.restore({ kind: "playlist", name: "Walks" });

		navigation.back();
		expect(navigation.current.page).toEqual({ kind: "playlists" });
		navigation.back();
		expect(navigation.current.page).toEqual({ kind: "library" });
	});

	test("every navigation by the user collapses the full player", () => {
		const navigation = new Navigation();
		const steps = [
			() => navigation.go({ kind: "latest" }),
			() => navigation.go({ kind: "latest" }),
			() => navigation.back(),
			() => navigation.back(),
			() => navigation.goRoot("played"),
			() => navigation.goRoot("played"),
		];

		for (const step of steps) {
			navigation.expand();
			step();
			expect(navigation.current.expanded).toBe(false);
		}
	});

	test("restoring the saved page leaves the full player as it is", () => {
		const navigation = new Navigation();
		navigation.go({ kind: "latest" });
		navigation.expand();

		navigation.restore({ kind: "feed", key: "Show" });
		expect(navigation.current).toEqual({
			page: { kind: "feed", key: "Show" },
			stack: [],
			expanded: true,
			scrollTop: 0,
		});
		navigation.restore({ kind: "feed", key: "Show" });
		expect(navigation.current.expanded).toBe(true);

		navigation.collapse();
		navigation.restore({ kind: "queue" });
		expect(navigation.current.expanded).toBe(false);
	});

	test("a step that changes nothing emits nothing", () => {
		const navigation = new Navigation();
		const states = recorded(navigation);

		navigation.go({ kind: "library" });
		navigation.goRoot("library");
		navigation.back();
		navigation.collapse();
		navigation.restore({ kind: "library" });
		navigation.expand();
		navigation.expand();

		expect(states).toEqual([
			{ page: { kind: "library" }, stack: [], expanded: true, scrollTop: 0 },
		]);
	});
});
