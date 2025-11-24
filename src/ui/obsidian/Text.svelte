<script lang="ts">
    import { TextComponent } from "obsidian";
    import type { CSSObject } from "src/types/CSSObject";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { afterUpdate, createEventDispatcher, onDestroy, onMount } from "svelte";

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
    let listenersAttached = false;

    onMount(() => {
        text = new TextComponent(textRef);

        updateTextComponentAttributes(text);
    });

    afterUpdate(() => {
        updateTextComponentAttributes(text);
    });

    onDestroy(() => {
        text?.inputEl?.removeEventListener("input", handleInput);
    });

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
        if (!component?.inputEl || listenersAttached) return;

        component.onChange(handleChange);
        component.inputEl.addEventListener("input", handleInput);
        listenersAttached = true;
    }

    function updateTextComponentAttributes(component: TextComponent) {
        if (value !== undefined) component.setValue(value);
        if (disabled) component.setDisabled(disabled);
        if (placeholder) component.setPlaceholder(placeholder);
        if (type) component.inputEl.type = type;
        if (styles) {
            text.inputEl.setAttr("style", extractStylesFromObj(styles));
        }
        if (component?.inputEl) {
            el = component.inputEl;
        }

        attachEventListeners(component);
    }
</script>

<span bind:this={textRef}></span>
