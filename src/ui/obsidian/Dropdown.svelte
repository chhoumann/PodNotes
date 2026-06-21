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

	// Keep the rendered dropdown in sync when `value` is changed from the
	// outside (e.g. a parent resetting bind:value after Add). The guard avoids
	// redundant DOM writes; setValue does not re-fire onChange.
	$: if (dropdown && value !== undefined && getDropdownValue(dropdown) !== value) {
		dropdown.setValue(value);
	}

	function getDropdownValue(component: DropdownComponent): string | undefined {
		return typeof component.getValue === "function"
			? component.getValue()
			: component.selectEl?.value;
	}

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
