<script lang="ts">
    import { SliderComponent } from "obsidian";
    import type { CSSObject } from "src/types/CSSObject";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { afterUpdate, createEventDispatcher, onMount } from "svelte";

    export let value: number;
    export let limits: [min: number, max: number] | [min: number, max: number, step: number];
    export { styles as style };

    let sliderRef: HTMLSpanElement;

    const dispatch = createEventDispatcher();

    let slider: SliderComponent;
    let styles: CSSObject;

    // This is not a complete implementation. I implemented what I needed.

    onMount(() => {
        slider = new SliderComponent(sliderRef);

        updateSliderAttributes(slider);
    });

    afterUpdate(() => {
        updateSliderAttributes(slider);
    });

    function updateSliderAttributes(sldr: SliderComponent) {
        if (value !== undefined) sldr.setValue(value);
        if (limits) {
            if (limits.length === 2) {
                sldr.setLimits(limits[0], limits[1], 1);
            } else {
                sldr.setLimits(limits[0], limits[1], limits[2]);
            }
        }
        if (styles) {
            sldr.sliderEl.setAttr("style", extractStylesFromObj(styles));
        }

        sldr.onChange((value: number) => {
            dispatch("change", { value });
        });
    }
</script>

<span bind:this={sliderRef}></span>
