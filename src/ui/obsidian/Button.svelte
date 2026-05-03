<script lang="ts">
    import { ButtonComponent } from "obsidian";
    import type { CSSObject } from "src/types/CSSObject";
    import type { IconType } from "src/types/IconType";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { afterUpdate, createEventDispatcher, onMount } from "svelte";

    export let text: string = "";
    export let tooltip: string = "";
    export let ariaLabel: string = "";
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
    let appliedClassTokens: string[] = [];
    let clickHandlerRegistered: boolean = false;

    const dispatch = createEventDispatcher();

    onMount(() => createButton(buttonRef));
    afterUpdate(() => {
        if (button) updateButtonAttributes(button);
    });

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
        updateButtonClasses(btn, className);
        if (cta) btn.setCta(); else btn.removeCta();

        registerClickHandler(btn);

        if (styles) {
            btn.buttonEl.setAttr('style', extractStylesFromObj(styles));
        }

        if (ariaLabel) {
            btn.buttonEl.setAttr("aria-label", ariaLabel);
        } else {
            btn.buttonEl.removeAttribute("aria-label");
        }
    }

    function updateButtonClasses(btn: ButtonComponent, currentClassName: string | undefined) {
        const nextClassTokens = currentClassName?.split(/\s+/).filter(Boolean) ?? [];

        if (appliedClassTokens.length) {
            btn.buttonEl.classList.remove(...appliedClassTokens);
        }

        nextClassTokens.forEach((token) => btn.setClass(token));
        appliedClassTokens = nextClassTokens;
    }

    function registerClickHandler(btn: ButtonComponent) {
        if (clickHandlerRegistered) return;

        btn.onClick((event: MouseEvent) => {
            dispatch("click", { event });
        });
        clickHandlerRegistered = true;
    }

</script>

<span 
    bind:this={buttonRef} 
></span>
