<script lang="ts">
    import { setIcon } from "obsidian";
    import { IconType } from "src/types/IconType";
    import { afterUpdate, createEventDispatcher, onMount, tick } from "svelte";

    export let size: number = 16;
    export let icon: IconType;
    export {styles as style};

    let ref: HTMLSpanElement;
    let styles: string = "";

    const dispatch = createEventDispatcher();

    onMount(() => {
        setIcon(ref, icon, size);
    });

    afterUpdate(() => {
        setIcon(ref, icon, size);
    });

    function forwardClick(event: MouseEvent) {
        dispatch("click", { event });
    }
</script>

<div 
    on:click={forwardClick} 
    class="icon-clickable" 
    style={styles}
>
    <span bind:this={ref} />
</div>

<style>
    .icon-clickable {
        cursor: pointer;
    }
</style>