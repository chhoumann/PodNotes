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
    export {styles as style};

    let ref: HTMLSpanElement;
    let styles: CSSObject = {};
    let stylesStr: string;

    $: stylesStr = extractStylesFromObj(styles);

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
        if (!clickable) return;
        dispatch("click", { event });
    }
</script>

<div 
    on:click={forwardClick} 
    class={clickable ? "icon-clickable" : ""}
	aria-label={label}
	role="button"
	tabindex={clickable ? 0 : -1}
	on:keydown={(event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			forwardClick(event as unknown as MouseEvent);
		}
	}}
>
    <span bind:this={ref}></span>
</div>

<style>
    .icon-clickable {
        cursor: pointer;
    }
</style>
