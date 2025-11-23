<script lang="ts">
	import { DropdownComponent } from "obsidian";
	import type { CSSObject } from "src/types/CSSObject";
	import extractStylesFromObj from "src/utility/extractStylesFromObj";
	import { createEventDispatcher, onMount } from "svelte";

	export let value: string = "";
	export let options: Record<string, string> = {};
    export let disabled: boolean = false;
    export { styles as style };
	
	let dropdownRef: HTMLSpanElement;
	let dropdown: DropdownComponent;
	let styles: CSSObject;

    const dispatch = createEventDispatcher();

	onMount(() => {
		dropdown = new DropdownComponent(dropdownRef);

		updateDropdownAttributes(dropdown);
	});

	function updateDropdownAttributes(dropdown: DropdownComponent) {
		if (options) dropdown.addOptions(options);
		if (value) dropdown.setValue(value);
		if (disabled) dropdown.setDisabled(disabled);
		
		
		dropdown.onChange((value: string) => {
			dispatch("change", { value });
		});

        if (styles) {
            dropdown.selectEl.setAttr('style', extractStylesFromObj(styles));
        }
	}

</script>

<span bind:this={dropdownRef}></span>
