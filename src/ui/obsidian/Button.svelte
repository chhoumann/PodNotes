<script lang="ts">
    import { ButtonComponent } from "obsidian";
    import { CSSObject } from "src/types/CSSObject";
    import { IconType } from "src/types/IconType";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { afterUpdate, createEventDispatcher, onMount } from "svelte";

    export let text: string = "";
    export let tooltip: string = "";
    export let icon: IconType | undefined = undefined;
    export let disabled: boolean = false;
    export let warning: boolean = false;
    export let cta: boolean = false;
    export { className as class };
    export { styles as style };

    let buttonRef: HTMLSpanElement;
    let className: string;
    let styles: CSSObject;

    let button: ButtonComponent;

    const dispatch = createEventDispatcher();

    onMount(() => createButton(buttonRef));
    afterUpdate(() => updateButtonAttributes(button));

    function createButton(container: HTMLElement) {
        button = new ButtonComponent(container);
        
        updateButtonAttributes(button);
    }

    function updateButtonAttributes(btn: ButtonComponent) {
        if (text) btn.setButtonText(text);
        if (tooltip) btn.setTooltip(tooltip);
        if (icon) btn.setIcon(icon);
        if (disabled) btn.setDisabled(disabled);
        if (warning) btn.setWarning(); else btn.buttonEl.classList.remove('mod-warning');
        if (className) btn.setClass(className);
        if (cta) btn.setCta(); else btn.removeCta();

        btn.onClick((event: MouseEvent) => {
            dispatch("click", { event });
        });

        if (styles) {
            btn.buttonEl.setAttr('style', extractStylesFromObj(styles));
        }
    }

</script>

<span 
    bind:this={buttonRef} 
/>