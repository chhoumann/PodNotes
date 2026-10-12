import { get, writable, type Readable, type Subscriber, type Unsubscriber } from "svelte/store";
import { parentOf, samePage, type Page, type RootKind } from "./pages";

export interface StackEntry {
	readonly page: Page;
	/** Where the page was scrolled when the user left it. */
	readonly scrollTop: number;
}

export interface NavState {
	readonly page: Page;
	/** The pages visited before `page`, oldest first. A rail root clears it. */
	readonly stack: readonly StackEntry[];
	/** The full player covers the view. It shows only while an episode is loaded. */
	readonly expanded: boolean;
	/** Where `page` opens scrolled: the saved position after Back, else the top. */
	readonly scrollTop: number;
}

/**
 * Where the view is, for the whole plugin: the view renders it, and commands,
 * links and menus open the full player through it, even while no view exists.
 * Every navigation by the user collapses the full player, and a change to nothing
 * emits nothing.
 */
export class Navigation implements Readable<NavState> {
	private readonly state = writable<NavState>({
		page: { kind: "library" },
		stack: [],
		expanded: false,
		scrollTop: 0,
	});
	// The shell reports every scroll here; it changes no state until the user leaves the page.
	private liveScrollTop = 0;

	subscribe(run: Subscriber<NavState>): Unsubscriber {
		return this.state.subscribe(run);
	}

	get current(): NavState {
		return get(this.state);
	}

	rememberScroll(top: number): void {
		this.liveScrollTop = top;
	}

	go(page: Page): void {
		const { page: from, stack } = this.current;
		if (samePage(from, page)) return this.collapse();
		this.show(page, [...stack, { page: from, scrollTop: this.liveScrollTop }], 0);
	}

	goRoot(kind: RootKind): void {
		const { page, stack } = this.current;
		if (page.kind === kind && stack.length === 0) return this.collapse();
		this.show({ kind }, [], 0);
	}

	back(): void {
		const { page, stack } = this.current;
		const previous = stack[stack.length - 1];
		if (previous) return this.show(previous.page, stack.slice(0, -1), previous.scrollTop);
		const parent = parentOf(page);
		if (parent) return this.show(parent, [], 0);
		this.collapse();
	}

	expand(): void {
		if (!this.current.expanded) this.state.update((state) => ({ ...state, expanded: true }));
	}

	collapse(): void {
		if (this.current.expanded) this.state.update((state) => ({ ...state, expanded: false }));
	}

	/**
	 * Shows the page saved in the workspace. Back then leads to its parent. The full
	 * player stays as it is: Obsidian restores a deferred view as Show player reveals it.
	 */
	restore(page: Page): void {
		const { page: from, stack, expanded } = this.current;
		if (samePage(from, page) && stack.length === 0) return;
		this.show(page, [], 0, expanded);
	}

	private show(
		page: Page,
		stack: readonly StackEntry[],
		scrollTop: number,
		expanded = false,
	): void {
		this.liveScrollTop = scrollTop;
		this.state.set({ page, stack, expanded, scrollTop });
	}
}
