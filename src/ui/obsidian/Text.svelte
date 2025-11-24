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
    let textChangeHandler: ((event: Event) => void) | null = null;

    onMount(() => {
        text = new TextComponent(textRef);

        textChangeHandler = (event: Event) => {
            const newValue = (event.target as HTMLInputElement).value;
            value = newValue;
            dispatch("change", { value: newValue });
        };

        text.inputEl.addEventListener("input", textChangeHandler);
    });

    onDestroy(() => {
        if (text?.inputEl && textChangeHandler) {
            text.inputEl.removeEventListener("input", textChangeHandler);
        }
    });

    $: if (text) {
        updateTextComponentAttributes(text, value, disabled, placeholder, type, styles);
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
