<script lang="ts">
	import { icon } from "../obsidian/icon";

	let {
		value,
		placeholder,
		autofocus = false,
		oninput,
	}: {
		value: string;
		placeholder: string;
		/** With the caret after the text, so typing goes on where it left off. */
		autofocus?: boolean;
		/** Not while an input method composes, so a half-composed word is never searched. */
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
			el.focus();
			el.setSelectionRange(el.value.length, el.value.length);
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
