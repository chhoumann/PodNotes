<script lang="ts">
    import { setIcon } from "obsidian";
    import type { CSSObject } from "src/types/CSSObject";
    import type { IconType } from "src/types/IconType";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { afterUpdate, createEventDispatcher, onMount } from "svelte";

    export let size: number = 16;
    export let icon: IconType;
	export let clickable: boolean = true;
	export let label: string = "";
	export let pressed: boolean | undefined = undefined;
	export let disabled: boolean = false;
    export {styles as style};

    let ref: HTMLSpanElement;
    let styles: CSSObject = {};
    let stylesStr: string;
    let pressedAttr: "true" | "false" | undefined;

    $: stylesStr = extractStylesFromObj(styles);
    $: pressedAttr =
        pressed === undefined ? undefined : (pressed ? "true" : "false");

    const dispatch = createEventDispatcher();

    onMount(() => {
        setIcon(ref, icon);
        applyIconStyles();
    });

    afterUpdate(() => {
        setIcon(ref, icon);
        applyIconStyles();
    });

	function applyIconStyles() {
		if (!ref) return;
		ref.style.cssText = stylesStr;

		if (size) {
			ref.style.width = `${size}px`;
			ref.style.height = `${size}px`;
		}
	}

    function forwardClick(event: MouseEvent) {
        if (!clickable || disabled) return;
        dispatch("click", { event });
    }
</script>

{#if clickable}
    <button
        type="button"
        class="icon-button"
        on:click={forwardClick}
        aria-label={label}
        aria-pressed={pressedAttr}
        disabled={disabled}
    >
        <span bind:this={ref}></span>
    </button>
{:else}
    <span
        class="icon-static"
        aria-label={label || undefined}
        aria-hidden={label ? undefined : "true"}
        bind:this={ref}
    ></span>
{/if}

<style>
    .icon-button {
        border: none;
        background: none;
        padding: 0;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .icon-button:disabled {
        cursor: not-allowed;
        opacity: 0.4;
    }

    .icon-static {
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
</style>
