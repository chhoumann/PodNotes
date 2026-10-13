<script lang="ts">
	import { icon } from "../obsidian/icon";
	import { observeWidth } from "./layout";

	let {
		value,
		placeholder,
		autofocus = false,
		oninput,
	}: {
		value: string;
		placeholder: string;
		autofocus?: boolean;
		oninput(value: string): void;
	} = $props();
	let input: HTMLInputElement;
</script>

<div class="pn-search">
	<span class="pn-search-icon" {@attach icon("search")}></span>
	<input
		bind:this={input}
		class="pn-input"
		type="search"
		{value}
		{placeholder}
		aria-label={placeholder}
		autocomplete="off"
		spellcheck="false"
		oninput={(event) => {
			if (!(event as Event as InputEvent).isComposing) oninput(event.currentTarget.value);
		}}
		oncompositionend={(event) => oninput(event.currentTarget.value)}
		{@attach (el) => {
			if (!autofocus) return;
			// A view mounts before Obsidian reveals its leaf, and a hidden field cannot take focus.
			let shown = false;
			return observeWidth((width) => {
				if (shown || width === 0) return;
				shown = true;
				el.focus();
				el.setSelectionRange(el.value.length, el.value.length);
			})(el);
		}}
	/>
	{#if value}
		<button
			type="button"
			class="pn-iconbtn pn-clear"
			aria-label="Clear"
			title="Clear"
			onclick={() => {
				oninput("");
				input.focus();
			}}
			{@attach icon("x")}
		></button>
	{/if}
</div>
