import { parse } from "yaml";

export class SecretStorage {
	private values = new Map<string, string>();

	setSecret(id: string, secret: string): void {
		this.values.set(id, secret);
	}

	getSecret(id: string): string | null {
		return this.values.get(id) ?? null;
	}

	listSecrets(): string[] {
		return [...this.values.keys()];
	}
}

export type KeymapEventListener = (evt: KeyboardEvent, ctx: unknown) => false | unknown;

interface KeymapEventHandler {
	key: string | null;
	func: KeymapEventListener;
}

export class Scope {
	/** The window whose stack the scope is on, as Obsidian records it. */
	win: Window | null = null;
	private handlers: KeymapEventHandler[] = [];

	constructor(private readonly parent?: Scope) {}

	register(_modifiers: string[] | null, key: string | null, func: KeymapEventListener) {
		const handler = { key, func };
		this.handlers.push(handler);
		return handler;
	}

	unregister(handler: KeymapEventHandler): void {
		this.handlers = this.handlers.filter((registered) => registered !== handler);
	}

	/** As Obsidian: the first handler for the key decides, else the parent scope does. */
	handleKey(evt: KeyboardEvent): unknown {
		for (const { key, func } of this.handlers) {
			if (key !== null && key !== evt.key) continue;
			const result = func(evt, {});
			if (result !== undefined || key !== null) return result;
		}
		return this.parent?.handleKey(evt);
	}
}

interface WindowStack {
	scope: Scope;
	prevScopes: Scope[];
}

/** Obsidian's scope stacks: one per window, and the active window's top scope gets every key. */
export class Keymap {
	private readonly stacks = new WeakMap<Window, WindowStack>();

	constructor(private readonly root: Scope) {}

	private stackOf(win: Window): WindowStack {
		let stack = this.stacks.get(win);
		if (!stack) this.stacks.set(win, (stack = { scope: this.root, prevScopes: [] }));
		return stack;
	}

	pushScope(scope: Scope): void {
		const stack = this.stackOf(activeWindow);
		if (stack.scope === scope) return;
		stack.prevScopes.push(stack.scope);
		stack.scope = scope;
		scope.win = activeWindow;
	}

	popScope(scope: Scope): void {
		if (scope === this.root || !scope.win) return;
		const stack = this.stackOf(scope.win);
		if (stack.scope === scope) stack.scope = stack.prevScopes.pop() ?? this.root;
		else stack.prevScopes = stack.prevScopes.filter((pushed) => pushed !== scope);
		scope.win = null;
	}

	/** Test only: Obsidian runs this for every keydown in each of its windows. */
	dispatch(evt: KeyboardEvent): void {
		if (this.stackOf(activeWindow).scope.handleKey(evt) === false) {
			evt.preventDefault();
			evt.stopPropagation();
		}
	}
}

interface EventRef {
	e: { offref(ref: EventRef): void };
}

export class Workspace {
	private readonly refs = new Set<EventRef & { name: string; callback(): unknown }>();

	on(name: string, callback: () => unknown): EventRef {
		const ref = { e: this, name, callback };
		this.refs.add(ref);
		return ref;
	}

	offref(ref: EventRef): void {
		this.refs.delete(ref as EventRef & { name: string; callback(): unknown });
	}

	trigger(name: string): void {
		for (const ref of [...this.refs]) if (ref.name === name) ref.callback();
	}
}

export class App {
	secretStorage = new SecretStorage();
	scope = new Scope();
	keymap = new Keymap(this.scope);
	workspace = new Workspace();
}
export class Plugin {}

/** Obsidian's lifecycle: a callback registered after unload never runs. */
export class Component {
	app?: App;
	private loaded = false;
	private cleanups: Array<() => unknown> = [];

	load(): void {
		if (this.loaded) return;
		this.loaded = true;
		this.onload();
	}

	onload(): void {}

	unload(): void {
		if (!this.loaded) return;
		this.loaded = false;
		while (this.cleanups.length > 0) this.cleanups.pop()?.();
		this.onunload();
	}

	onunload(): void {}

	register(cb: () => unknown): void {
		this.cleanups.push(cb);
	}

	registerEvent(ref: EventRef): void {
		this.register(() => ref.e.offref(ref));
	}
}

export class TFile {
	path: string;
	extension: string;

	constructor(path = "") {
		this.path = path;
		this.extension = path.split(".").pop() ?? "";
	}
}

export class TFolder {
	constructor(
		public path: string,
		public children: Array<TFile | TFolder> = [],
	) {}
}

export class Notice {
	hidden = false;

	constructor(
		public message?: string | DocumentFragment,
		public duration?: number,
	) {}

	setMessage(message: string | DocumentFragment): this {
		this.message = message;
		return this;
	}

	hide(): void {
		this.hidden = true;
	}
}

export const normalizePath = (path: string): string => {
	const normalized: string[] = [];
	for (const segment of path.replaceAll("\\", "/").split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") normalized.pop();
		else normalized.push(segment);
	}
	return normalized.join("/");
};

export class WorkspaceLeaf {}
export class ItemView extends Component {
	/** Obsidian loads a view before onOpen and unloads it before onClose. */
	async open(): Promise<void> {
		this.load();
		await this.onOpen();
	}

	async close(): Promise<void> {
		this.unload();
		await this.onClose();
	}

	protected async onOpen(): Promise<void> {}

	protected async onClose(): Promise<void> {}

	getState(): Record<string, unknown> {
		return {};
	}

	async setState(_state: unknown, _result: unknown): Promise<void> {}
}

export class MarkdownView {
	editor: unknown;
	file: TFile | null = null;

	constructor(public leaf: WorkspaceLeaf) {}

	getMode(): "source" | "preview" {
		return "source";
	}
}

export class Modal {
	app: App;
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	contentEl: HTMLElement;
	titleEl: HTMLElement;

	constructor(app: App) {
		this.app = app;
		this.containerEl = document.createElement("div");
		this.modalEl = document.createElement("div");
		this.titleEl = document.createElement("div");
		this.contentEl = document.createElement("div");
		const closeButtonEl = document.createElement("div");
		closeButtonEl.className = "modal-header-button";
		closeButtonEl.addEventListener("click", () => this.close());
		this.modalEl.append(closeButtonEl, this.titleEl, this.contentEl);
		this.containerEl.append(this.modalEl);
	}

	open(): void {
		document.body.appendChild(this.containerEl);
		this.onOpen();
	}

	close(): void {
		this.onClose();
		this.containerEl.remove();
	}

	onOpen(): void {}
	onClose(): void {}
}

export class SuggestModal<T> extends Modal {
	declare protected readonly itemType?: T;
	inputEl = document.createElement("input");

	setPlaceholder(placeholder: string): void {
		this.inputEl.placeholder = placeholder;
	}
}

export class FuzzySuggestModal<T> extends SuggestModal<T> {
	getItems(): T[] {
		return [];
	}

	getItemText(_item: T): string {
		return "";
	}

	onChooseItem(_item: T, _evt?: MouseEvent | KeyboardEvent): void {}
}

class BaseInteractiveElement {
	protected element: HTMLElement;

	constructor(tag: keyof HTMLElementTagNameMap, container: HTMLElement) {
		this.element = document.createElement(tag);
		container.appendChild(this.element);
	}
}

export class ButtonComponent extends BaseInteractiveElement {
	private clickCallback?: (event: MouseEvent) => void;

	constructor(container: HTMLElement) {
		super("button", container);
		this.buttonEl.addEventListener("click", (event) => {
			if (!this.buttonEl.disabled) this.clickCallback?.(event);
		});
	}

	get buttonEl() {
		return this.element as HTMLButtonElement;
	}

	setButtonText(text: string) {
		this.buttonEl.textContent = text;
		return this;
	}

	setTooltip(tooltip: string) {
		this.buttonEl.title = tooltip;
		return this;
	}

	setIcon(icon: string) {
		this.buttonEl.setAttribute("data-icon", icon);
		return this;
	}

	setDisabled(disabled: boolean) {
		this.buttonEl.disabled = disabled;
		return this;
	}

	setWarning() {
		this.buttonEl.classList.add("mod-warning");
		return this;
	}

	setDestructive() {
		this.buttonEl.classList.add("mod-destructive");
		return this;
	}

	setClass(value: string) {
		this.buttonEl.className = value;
		return this;
	}

	setCta() {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}

	removeCta() {
		this.buttonEl.classList.remove("mod-cta");
		return this;
	}

	onClick(callback: (event: MouseEvent) => void) {
		this.clickCallback = callback;
		return this;
	}
}

export class DropdownComponent extends BaseInteractiveElement {
	constructor(container: HTMLElement) {
		super("select", container);
	}

	get selectEl() {
		return this.element as HTMLSelectElement;
	}

	addOptions(options: Record<string, string>) {
		this.selectEl.innerHTML = "";

		Object.entries(options).forEach(([value, label]) => {
			const option = document.createElement("option");
			option.value = value;
			option.textContent = label;
			this.selectEl.appendChild(option);
		});

		return this;
	}

	setValue(value: string) {
		this.selectEl.value = value;
		return this;
	}

	setDisabled(disabled: boolean) {
		this.selectEl.disabled = disabled;
		return this;
	}

	onChange(callback: (value: string) => void) {
		this.selectEl.addEventListener("change", () => callback(this.selectEl.value));
		return this;
	}
}

export class SliderComponent extends BaseInteractiveElement {
	constructor(container: HTMLElement) {
		super("input", container);
		this.sliderEl.type = "range";
	}

	get sliderEl() {
		return this.element as HTMLInputElement;
	}

	setLimits(min: number, max: number, step = 1) {
		this.sliderEl.min = min.toString();
		this.sliderEl.max = max.toString();
		this.sliderEl.step = step.toString();
		return this;
	}

	setValue(value: number) {
		this.sliderEl.value = value.toString();
		return this;
	}

	setDynamicTooltip() {
		return this;
	}

	onChange(callback: (value: number) => void) {
		this.sliderEl.addEventListener("input", () => callback(Number(this.sliderEl.value)));
		return this;
	}
}

export class TextComponent extends BaseInteractiveElement {
	constructor(container: HTMLElement) {
		super("input", container);
	}

	get inputEl() {
		return this.element as HTMLInputElement;
	}

	setValue(value: string) {
		this.inputEl.value = value;
		return this;
	}

	setDisabled(disabled: boolean) {
		this.inputEl.disabled = disabled;
		return this;
	}

	setPlaceholder(value: string) {
		this.inputEl.placeholder = value;
		return this;
	}

	onChange(callback: (value: string) => void) {
		this.inputEl.addEventListener("input", () => callback(this.inputEl.value));
		return this;
	}
}

export class SecretComponent extends TextComponent {
	constructor(
		public app: App,
		container: HTMLElement,
	) {
		super(container);
	}
}

export class Setting {
	settingEl: HTMLElement;
	nameEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.settingEl = document.createElement("div");
		this.nameEl = document.createElement("div");
		this.settingEl.appendChild(this.nameEl);
		containerEl.appendChild(this.settingEl);
	}

	setName(name: string) {
		this.nameEl.textContent = name;
		return this;
	}

	setDesc() {
		return this;
	}

	setHeading() {
		return this;
	}

	addText(callback: (component: TextComponent) => void) {
		callback(new TextComponent(this.settingEl));
		return this;
	}

	addTextArea(callback: (component: TextComponent) => void) {
		callback(new TextComponent(this.settingEl));
		return this;
	}

	addSlider(callback: (component: SliderComponent) => void) {
		callback(new SliderComponent(this.settingEl));
		return this;
	}

	addButton(callback: (component: ButtonComponent) => void) {
		callback(new ButtonComponent(this.settingEl));
		return this;
	}

	addComponent<T>(callback: (container: HTMLElement) => T) {
		callback(this.settingEl);
		return this;
	}
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: HTMLElement;

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement("div");
	}

	display(): void {}
	update(): void {}
	hide(): void {}
}

export const MarkdownRenderer = {
	render: async (
		_app: App,
		markdown: string,
		container: HTMLElement,
		_source: string,
		_component: Component,
	) => {
		container.textContent = markdown;
	},
	renderMarkdown: async (
		markdown: string,
		container: HTMLElement,
		_source: string,
		_component: Component,
	) => {
		container.textContent = markdown;
	},
};

export class MenuItem {
	title = "";
	icon: string | null = null;
	checked: boolean | null = null;
	callback: (() => void) | null = null;

	setIcon(icon: string | null) {
		this.icon = icon;
		return this;
	}
	setTitle(title: string) {
		this.title = title;
		return this;
	}
	setChecked(checked: boolean | null) {
		this.checked = checked;
		return this;
	}
	setWarning(_warning: boolean) {
		return this;
	}
	setDisabled(_disabled: boolean) {
		return this;
	}
	onClick(callback: () => void) {
		this.callback = callback;
		return this;
	}
}

export class Menu {
	/** Test only: the menu on screen, until it hides. */
	static shown: Menu | null = null;
	items: Array<MenuItem | "separator"> = [];
	private hideCallback: (() => unknown) | null = null;

	addItem(callback: (item: MenuItem) => void) {
		const item = new MenuItem();
		this.items.push(item);
		callback(item);
		return this;
	}

	addSeparator() {
		this.items.push("separator");
		return this;
	}

	onHide(callback: () => unknown) {
		this.hideCallback = callback;
	}

	showAtMouseEvent() {
		Menu.shown = this;
		return this;
	}

	showAtPosition() {
		Menu.shown = this;
		return this;
	}

	hide() {
		if (Menu.shown === this) Menu.shown = null;
		const callback = this.hideCallback;
		this.hideCallback = null;
		callback?.();
		return this;
	}

	close() {
		this.hide();
	}

	/** Test only: as Obsidian, runs the item, then hides the menu. */
	pick(title: string) {
		const item = this.items.find(
			(entry): entry is MenuItem => entry !== "separator" && entry.title === title,
		);
		if (!item) throw new Error(`No menu item ${title}`);
		item.callback?.();
		this.hide();
	}
}

export const debounce = <T extends (...args: unknown[]) => unknown>(fn: T) => {
	let timeout: ReturnType<typeof setTimeout> | undefined;

	const debounced = (...args: Parameters<T>) => {
		if (timeout) {
			clearTimeout(timeout);
		}

		timeout = setTimeout(() => fn(...args), 0);
	};

	debounced.cancel = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
	};

	return debounced;
};

export const setIcon = (el: HTMLElement | null, icon: string) => {
	if (!el) return;
	el.setAttribute("data-icon", icon);
};

export const requestUrl = async () => ({
	status: 200,
	headers: {},
	arrayBuffer: new ArrayBuffer(0),
	text: "",
	json: {},
});

export const htmlToMarkdown = (value: string) => value;

// Obsidian's parseYaml is eemeli/yaml's parse(text, null, {}).
export const parseYaml = (text: string): unknown => parse(text, {});

// Mutable so tests can simulate a specific OS (e.g. set isMacOS=false, isLinux=true).
// Defaults to a desktop macOS profile, matching the typical dev environment.
export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isPhone: false,
	isTablet: false,
	isWin: false,
	isMacOS: true,
	isLinux: false,
	isIosApp: false,
	isAndroidApp: false,
	isSafari: false,
};
