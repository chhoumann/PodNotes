<script lang="ts">
    import { SliderComponent } from "obsidian";
    import type { CSSObject } from "src/types/CSSObject";
    import extractStylesFromObj from "src/utility/extractStylesFromObj";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";

    export let value: number;
    export let limits: [min: number, max: number] | [min: number, max: number, step: number];
    export { styles as style };

    let sliderRef: HTMLSpanElement;

    const dispatch = createEventDispatcher();

    let slider: SliderComponent;
    let styles: CSSObject = {};
    let changeHandler: ((event: Event) => void) | null = null;

    // This is not a complete implementation. I implemented what I needed.

    onMount(() => {
        slider = new SliderComponent(sliderRef);

        changeHandler = (event: Event) => {
            const newValue = Number((event.target as HTMLInputElement).value);
            dispatch("change", { value: newValue });
        };

        slider.sliderEl.addEventListener("input", changeHandler);
    });

    onDestroy(() => {
        if (slider?.sliderEl && changeHandler) {
            slider.sliderEl.removeEventListener("input", changeHandler);
        }
    });

    $: if (slider) {
        updateSliderAttributes(slider, value, limits, styles);
    }

    function updateSliderAttributes(
        sldr: SliderComponent,
        currentValue: number,
        currentLimits: [min: number, max: number] | [min: number, max: number, step: number],
        currentStyles: CSSObject
    ) {
        if (currentValue !== undefined) sldr.setValue(currentValue);
        if (currentLimits) {
            if (currentLimits.length === 2) {
                sldr.setLimits(currentLimits[0], currentLimits[1], 1);
            } else {
                sldr.setLimits(currentLimits[0], currentLimits[1], currentLimits[2]);
            }
        }
        if (currentStyles) {
            sldr.sliderEl.setAttr("style", extractStylesFromObj(currentStyles));
        }
    }
</script>

<span bind:this={sliderRef}></span>
