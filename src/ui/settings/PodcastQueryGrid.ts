import { IPodNotes } from './../../../main';
import { ButtonComponent, debounce, TextComponent } from "obsidian";
import { consume } from "src/iTunesAPIConsumer";
import { Player } from "src/Player";
import { PodcastFeed } from "src/types/PodcastFeed";

export function PodcastQueryGrid(container: HTMLElement, plugin: IPodNotes) {
	container.empty();

	container.createEl('h3', { text: 'Search for a podcast' });
	
	const inputEl = new TextComponent(container);
	inputEl.inputEl.style.marginBottom = '0.5rem';
	inputEl.inputEl.style.width = "100%";
	inputEl.setPlaceholder('Search for a podcast');

	const debouncedUpdate = debounce(async (value: string) => {
		const results = await consume(value);
		renderSearchResults(searchResultsContainer, results, plugin);
	}, 500, true);
	inputEl.onChange(debouncedUpdate);

	const searchResultsContainer = container.createDiv();
	searchResultsContainer.classList.add('search-results-container');
}

function renderSearchResults(container: HTMLElement, results: PodcastFeed[], plugin: IPodNotes) {
	container.empty();

	if (results.length === 0) {
		const noResults = container.createDiv();
		noResults.innerText = 'No results found';
		return;
	}

	container.classList.remove('grid-3');
	container.classList.remove('grid-2');
	container.classList.remove('grid-1');

	if (results.length % 3 === 0 || results.length > 3) {
		container.classList.add('grid-3');
	} else if (results.length % 2 === 0) {
		container.classList.add('grid-2');
	} else if (results.length % 1 === 0) {
		container.classList.add('grid-1');
	}

	
	for (const result of results) {
		const resultEl = container.createDiv();
		resultEl.classList.add('result-container');

		const imageContainer = resultEl.createDiv();
		imageContainer.classList.add('result-image-container');
		const img = imageContainer.createEl('img');
		img.src = result.artworkUrl || "";
		img.addClass('result-podcast-artwork');

		const title = resultEl.createEl('h4', { text: result.title });
		title.style.textAlign = "center";

		const buttonEl = new ButtonComponent(resultEl);
		buttonEl.setButtonText("Add");
		buttonEl.onClick(() => {
			plugin.settings.savedFeeds[result.title] = result;
			Player.Instance.new();
			buttonEl.setDisabled(true);
			buttonEl.setButtonText("Added");
			plugin.saveSettings();
		});
	}
}
