<script lang="ts">
    import { TextComponent } from "obsidian";
    import type { CSSObject } from "src/types/CSSObject";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { afterUpdate, onMount } from "svelte";

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

    onMount(() => {
        text = new TextComponent(textRef);

        updateTextComponentAttributes(text);
    });

    afterUpdate(() => {
        updateTextComponentAttributes(text);
    });

    function updateTextComponentAttributes(component: TextComponent) {
        if (value !== undefined) component.setValue(value);
        if (disabled) component.setDisabled(disabled);
        if (placeholder) component.setPlaceholder(placeholder);
        if (type) component.inputEl.type = type;
        if (styles) {
            text.inputEl.setAttr("style", extractStylesFromObj(styles));
        }

        component.onChange((newValue: string) => {
            value = newValue;
            onchange?.(newValue);
        });
    }
</script>

<span bind:this={textRef}></span>
