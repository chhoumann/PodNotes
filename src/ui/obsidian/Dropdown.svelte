<script lang="ts">
	import { DropdownComponent } from "obsidian";
	import type { CSSObject } from "src/types/CSSObject";
	import extractStylesFromObj from "src/utility/extractStylesFromObj";
	import { afterUpdate, onMount } from "svelte";

	// Props
	export let value: string = "";
	export let options: Record<string, string> = {};
    export let disabled: boolean = false;
    export { styles as style };
    
    // Event callback prop
    export let onchange: ((value: string) => void) | undefined = undefined;
	
	let dropdownRef: HTMLSpanElement;
	let dropdown: DropdownComponent;
	let styles: CSSObject;

	onMount(() => {
		if (dropdownRef) {
			dropdown = new DropdownComponent(dropdownRef);
			updateDropdownAttributes(dropdown);
		}
	});

	afterUpdate(() => {
		if (dropdown) {
			updateDropdownAttributes(dropdown);
		}
	});

	function updateDropdownAttributes(dd: DropdownComponent) {
		if (options) dd.addOptions(options);
		if (value) dd.setValue(value);
		if (disabled) dd.setDisabled(disabled);
		
		dd.onChange((value: string) => {
			onchange?.(value);
		});

        if (styles) {
            dd.selectEl.setAttr('style', extractStylesFromObj(styles));
        }
	}

</script>

<span bind:this={dropdownRef}></span>
