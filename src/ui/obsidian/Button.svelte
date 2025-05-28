<script lang="ts">
    import { ButtonComponent } from "obsidian";
    import type { CSSObject } from "src/types/CSSObject";
    import type { IconType } from "src/types/IconType";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { afterUpdate, onMount } from "svelte";

    // Props
    export let text: string = "";
    export let tooltip: string = "";
    export let icon: IconType | undefined = undefined;
    export let disabled: boolean = false;
    export let warning: boolean = false;
    export let cta: boolean = false;
    export { className as class };
    export { styles as style };
    
    // Event callback prop
    export let onclick: ((event: MouseEvent) => void) | undefined = undefined;

    let buttonRef: HTMLSpanElement;
    let className: string;
    let styles: CSSObject;

    let button: ButtonComponent;

    onMount(() => {
        if (buttonRef) {
            button = new ButtonComponent(buttonRef);
            updateButtonAttributes(button);
        }
    });

    afterUpdate(() => {
        if (button) {
            updateButtonAttributes(button);
        }
    });

    function updateButtonAttributes(btn: ButtonComponent) {
        if (text) btn.setButtonText(text);
        if (tooltip) btn.setTooltip(tooltip);
        if (icon) btn.setIcon(icon);
        if (disabled) btn.setDisabled(disabled);
        if (warning) btn.setWarning(); else btn.buttonEl.classList.remove('mod-warning');
        if (className) btn.setClass(className);
        if (cta) btn.setCta(); else btn.removeCta();

        btn.onClick((event: MouseEvent) => {
            onclick?.(event);
        });

        if (styles) {
            btn.buttonEl.setAttr('style', extractStylesFromObj(styles));
        }
    }

</script>

<span bind:this={buttonRef}></span>