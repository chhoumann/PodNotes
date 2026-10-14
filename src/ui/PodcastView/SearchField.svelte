<script lang="ts">
	import { icon } from "../obsidian/icon";
	import { observeWidth } from "./layout";

	let {
		value,
		placeholder,
		autofocus = false,
		large = false,
		oninput,
	}: {
		value: string;
		placeholder: string;
		autofocus?: boolean;
		/** The first run's wider, taller field. */
		large?: boolean;
		oninput(value: string): void;
	} = $props();
	let input: HTMLInputElement;
</script>

<div class="pn-search" class:is-large={large}>
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

<style>
	.pn-search {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	.pn-search :global {
		.pn-search-icon {
			position: absolute;
			left: var(--size-4-2);
			top: 50%;
			transform: translateY(-50%);
			display: flex;
			color: var(--text-muted);
			pointer-events: none;
			--icon-size: var(--icon-xs);
			--icon-stroke: var(--icon-xs-stroke-width);
		}

		.pn-input {
			width: 100%;
			padding: 0 28px;
		}

		.pn-input::placeholder {
			color: var(--text-muted);
		}

		.pn-input::-webkit-search-cancel-button {
			display: none;
		}

		button.pn-clear {
			position: absolute;
			right: 2px;
			top: 50%;
			transform: translateY(-50%);
			width: 24px;
			height: 24px;
		}
	}

	:global(.is-phone) .pn-search :global {
		.pn-input {
			height: 44px;
			padding-left: 34px;
		}

		.pn-search-icon {
			left: 12px;
			--icon-size: 16px;
		}

		button.pn-clear {
			right: 0;
			width: 44px;
			height: 44px;
		}
	}

	.pn-search.is-large {
		flex: none;
		width: 100%;
		max-width: 360px;
	}

	.pn-search.is-large :global {
		.pn-input {
			height: 36px;
			padding-left: 32px;
		}

		.pn-search-icon {
			left: 10px;
		}
	}

	:global(.is-phone) .pn-search.is-large :global(.pn-input) {
		height: 48px;
		padding-left: 36px;
	}
</style>
