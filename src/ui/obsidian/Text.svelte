<script lang="ts">
    import { TextComponent } from "obsidian";
    import type { CSSObject } from "src/types/CSSObject";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    export let value: string = "";
    export let disabled: boolean = false;
    export let placeholder: string = "";
    export let type: "text" | "password" | "email" | "number" | "tel" | "url" = "text";
    export let el: HTMLInputElement | null = null;
    export { styles as style };

    let textRef: HTMLSpanElement;

    const dispatch = createEventDispatcher();

    let text: TextComponent;
    let styles: CSSObject = {};
    let inputHandler: ((event: Event) => void) | null = null;
    let changeHandler: ((value: string) => void) | null = null;

    onMount(() => {
        text = new TextComponent(textRef);
    });

    onDestroy(() => {
        if (text?.inputEl && inputHandler) {
            text.inputEl.removeEventListener("input", inputHandler);
        }
    });

    $: if (text) {
        attachEventListeners(text);
        updateTextComponentAttributes(text, value, disabled, placeholder, type, styles);
    }

    function handleInput(event: Event) {
        const input = event.target as HTMLInputElement | null;
        const newValue = input?.value ?? "";

        value = newValue;
        dispatch("input", { value: newValue });
    }

    function handleChange(newValue: string) {
        value = newValue;
        dispatch("change", { value: newValue });
    }

    function attachEventListeners(component: TextComponent) {
        if (!component?.inputEl || inputHandler) return;

        changeHandler = handleChange;
        component.onChange(changeHandler);

        inputHandler = handleInput;
        component.inputEl.addEventListener("input", inputHandler);
    }

    function updateTextComponentAttributes(
        component: TextComponent,
        currentValue: string,
        isDisabled: boolean,
        currentPlaceholder: string,
        currentType: "text" | "password" | "email" | "number" | "tel" | "url",
        currentStyles: CSSObject
    ) {
        if (currentValue !== undefined) component.setValue(currentValue);
        if (isDisabled) component.setDisabled(isDisabled);
        if (currentPlaceholder) component.setPlaceholder(currentPlaceholder);
        if (currentType) component.inputEl.type = currentType;
        if (currentStyles) {
            component.inputEl.setAttr("style", extractStylesFromObj(currentStyles));
        }
        if (component?.inputEl) {
            el = component.inputEl;
        }
    }
</script>

<span bind:this={textRef}></span>
