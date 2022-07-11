<script lang="ts">
    import { SliderComponent } from "obsidian";
    import { afterUpdate, createEventDispatcher, onMount } from "svelte";

    export let value: number;
    export let limits: [min: number, max: number] | [min: number, max: number, step: number];

    let sliderRef: HTMLSpanElement;

    const dispatch = createEventDispatcher();

    let slider: SliderComponent;

    // This is not a complete implementation. I implemented what I needed.

    onMount(() => {
        slider = new SliderComponent(sliderRef);

        updateSliderAttributes(slider);
    });

    afterUpdate(() => {
        updateSliderAttributes(slider);
    });

    function updateSliderAttributes(sldr: SliderComponent) {
        if (value) sldr.setValue(value);
        if (limits) sldr.setLimits.apply(sldr, limits);
        
        sldr.onChange((value: number) => {
            dispatch("change", { value });
        });
    }
</script>

<span bind:this={sliderRef} />