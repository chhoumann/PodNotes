export class App {}
export class Plugin {}
export class Component {
	app?: App;
}

export class TFile {
	path: string;

	constructor(path: string) {
		this.path = path;
	}
}

export class Notice {
	constructor(public message?: string) {}
}

export class WorkspaceLeaf {}
export class ItemView {}

class BaseInteractiveElement {
	protected element: HTMLElement;

	constructor(tag: keyof HTMLElementTagNameMap, container: HTMLElement) {
		this.element = document.createElement(tag);
		container.appendChild(this.element);
	}
}

export class ButtonComponent extends BaseInteractiveElement {
	constructor(container: HTMLElement) {
		super("button", container);
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
		this.buttonEl.addEventListener("click", callback);
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
		this.sliderEl.addEventListener("input", () =>
			callback(Number(this.sliderEl.value)),
		);
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
		this.inputEl.addEventListener("input", () =>
			callback(this.inputEl.value),
		);
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.settingEl = document.createElement("div");
		containerEl.appendChild(this.settingEl);
	}

	setName() {
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
	hide(): void {}
}

export const MarkdownRenderer = {
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
	setIcon() {
		return this;
	}
	setTitle() {
		return this;
	}
	onClick(_callback: () => void) {
		return this;
	}
}

export class Menu {
	addItem(callback: (item: MenuItem) => void) {
		callback(new MenuItem());
		return this;
	}

	addSeparator() {
		return this;
	}

	showAtMouseEvent() {}
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
	text: "",
	json: async () => ({}),
});

export const htmlToMarkdown = (value: string) => value;
