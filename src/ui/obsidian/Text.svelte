<script lang="ts">
    import { TextComponent } from "obsidian";
    import { CSSObject } from "src/types/CSSObject";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { afterUpdate, createEventDispatcher, onMount } from "svelte";

    export let value: string = "";
    export let disabled: boolean = false;
    export let placeholder: string = "";
    export let type: "text" | "password" | "email" | "number" | "tel" | "url" = "text";
    export { styles as style };

    let textRef: HTMLSpanElement;

    const dispatch = createEventDispatcher();

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
        component.onChange((value: string) => {
            dispatch("change", { value });
        });

        if (value) component.setValue(value);
        if (disabled) component.setDisabled(disabled);
        if (placeholder) component.setPlaceholder(placeholder);
        if (type) component.inputEl.type = type;
        if (styles) {
            text.inputEl.setAttr("style", extractStylesFromObj(styles));
        }
    }
</script>

<span bind:this={textRef} />