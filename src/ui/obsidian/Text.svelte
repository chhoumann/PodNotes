<script lang="ts">
    import { TextComponent } from "obsidian";
    import type { CSSObject } from "src/types/CSSObject";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { onMount, onDestroy } from "svelte";

    export let value: string = "";
    export let disabled: boolean = false;
    export let placeholder: string = "";
    export let type: "text" | "password" | "email" | "number" | "tel" | "url" = "text";
    export { styles as style };
    
    // Event callback prop
    export let onchange: ((value: string) => void) | undefined = undefined;

    let textRef: HTMLSpanElement;
    let text: TextComponent;
    let styles: CSSObject = {};
    let isChanging = false;

    onMount(() => {
        text = new TextComponent(textRef);

        // Set initial values
        if (value !== undefined) text.setValue(value);
        if (disabled) text.setDisabled(disabled);
        if (placeholder) text.setPlaceholder(placeholder);
        if (type) text.inputEl.type = type;
        if (styles) {
            text.inputEl.setAttr("style", extractStylesFromObj(styles));
        }

        // Set up change handler once
        text.onChange((newValue: string) => {
            isChanging = true;
            value = newValue;
            onchange?.(newValue);
            isChanging = false;
        });
    });

    onDestroy(() => {
        // Clean up if needed
        text = null;
    });

    // Only update when props change and not during user input
    $: if (text && !isChanging && text.getValue() !== value) {
        text.setValue(value);
    }

    $: if (text && text.disabled !== disabled) {
        text.setDisabled(disabled);
    }

    $: if (text && text.inputEl.placeholder !== placeholder) {
        text.setPlaceholder(placeholder);
    }

    $: if (text && styles) {
        const newStyles = extractStylesFromObj(styles);
        if (text.inputEl.getAttribute("style") !== newStyles) {
            text.inputEl.setAttr("style", newStyles);
        }
    }
</script>

<span bind:this={textRef}></span>