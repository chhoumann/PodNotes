<script lang="ts">
    import { setIcon } from "obsidian";
    import { CSSObject } from "src/types/CSSObject";
    import { IconType } from "src/types/IconType";
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
        setIcon(ref, icon, size);
        ref.style.cssText = stylesStr;
    });

    afterUpdate(() => {
        setIcon(ref, icon, size);
        ref.style.cssText = stylesStr;
    });

    function forwardClick(event: MouseEvent) {
        dispatch("click", { event });
    }
</script>

<div 
    on:click={forwardClick} 
    class={clickable ? "icon-clickable" : ""}
	aria-label={label}
>
    <span bind:this={ref} />
</div>

<style>
    .icon-clickable {
        cursor: pointer;
    }
</style>
