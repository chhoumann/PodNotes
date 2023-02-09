import { Notice, requestUrl } from "obsidian";
import { downloadedEpisodes } from "./store";
import { DownloadPathTemplateEngine } from "./TemplateEngine";
import { Episode } from "./types/Episode";
import Progressbar from "./ui/common/Progressbar.svelte";
import getUrlExtension from "./utility/getUrlExtension";

async function downloadFile(
	url: string,
	options?: Partial<{
		onProgress: (progress: number, total: number) => void,
		onFinished: () => void
	}>
) {
	try {
		const response = await requestUrl({ url, method: "GET" });

		if (response.status !== 200) {
			throw new Error("Could not download episode.");
		}

		const contentLength = response.arrayBuffer.byteLength;

		options?.onFinished?.();

		return {
			blob: new Blob([response.arrayBuffer], { type: response.headers['content-type'] ?? "" }),
			contentLength,
			receivedLength: contentLength,
			responseUrl: url,
		};
	} catch (error) {
		throw new Error(`Failed to download ${url}: ${error.message}`);
	}
}

export default async function downloadEpisodeWithProgressNotice(episode: Episode, downloadPathTemplate: string): Promise<void> {
	const { doc, update } = createNoticeDoc(`Download "${episode.title}"`);
	const SOME_LARGE_INT_SO_THE_BOX_DOESNT_AUTO_CLOSE = 999999999;
	const notice = new Notice(doc, SOME_LARGE_INT_SO_THE_BOX_DOESNT_AUTO_CLOSE);

	update(bodyEl => bodyEl.createEl('p', { text: 'Starting download...' }));

	let progressBar: Progressbar;
	let percentEl: HTMLSpanElement;
	update(bodyEl => {
		percentEl = bodyEl.createSpan({ text: '0%' });
		progressBar = new Progressbar({
			target: bodyEl,
			props: {
				max: 100,
				value: 0,
				style: {
					width: '100%',
					height: '2rem',
				}
			}
		});
	});

	const { blob, responseUrl } = await downloadFile(episode.streamUrl, {
		onProgress: (progress, total) => {
			update(_ => {
				percentEl.textContent = `${Math.floor(progress / total * 100)}%`;
				progressBar.$set({ value: progress / total * 100 });
			}, false);
		},
		onFinished: () => {
			progressBar.$destroy();
			update(bodyEl => bodyEl.createEl('p', { text: 'Download complete!' }));
		}
	});

	console.log(blob);

	if (!blob.type.contains('audio')) {
		throw new Error('Not an audio file');
	}

	try {
		update(bodyEl => bodyEl.createEl('p', { text: `Creating file...` }));
		
		await createEpisodeFile({
			episode,
			downloadPathTemplate,
			blob,
			responseUrl,
		})

		update(bodyEl => bodyEl.createEl('p', { text: `Successfully downloaded "${episode.title}" from ${episode.podcastName}.` }));
	} catch (error) {
		update(bodyEl => {
			bodyEl.createEl('p', {
				text: `Failed to create file for downloaded episode "${episode.title}" from ${episode.podcastName}.`
			});

			const errorMsgEl = bodyEl.createEl('p', { text: error.message });
			errorMsgEl.style.fontStyle = 'italic';
		});
	}

	setTimeout(() => notice.hide(), 10000);
}

function createNoticeDoc(title: string) {
	const doc = new DocumentFragment();
	const container = doc.createDiv();
	container.style.width = "100%";
	container.style.display = 'flex';

	const titleEl = container.createEl('span', { text: title });
	titleEl.style.textAlign = 'center';
	titleEl.style.fontWeight = 'bold';
	titleEl.style.marginBottom = '0.5em';

	const bodyEl = doc.createDiv();
	bodyEl.style.display = 'flex';
	bodyEl.style.flexDirection = 'column';
	bodyEl.style.alignItems = 'center';
	bodyEl.style.justifyContent = 'center';

	return {
		doc,
		update: (updateFn: (bodyEl: HTMLDivElement) => void, empty = true) => {
			if (empty) bodyEl.empty();
			updateFn(bodyEl);
		},
	}
}

async function createEpisodeFile({episode, downloadPathTemplate, blob, responseUrl }: {
	episode: Episode,
	downloadPathTemplate: string,
	blob: Blob,
	responseUrl: string
}) {
	const basename = DownloadPathTemplateEngine(downloadPathTemplate, episode);
	const filePath = `${basename}.${getUrlExtension(responseUrl)}`;

	const buffer = await blob.arrayBuffer();
	
	try {
		await app.vault.createBinary(filePath, buffer);
	} catch (error) {
		throw new Error(`Failed to write file "${filePath}": ${error.message}`);
	}

	downloadedEpisodes.addEpisode(episode, filePath, blob.size);
}

export async function downloadEpisode(episode: Episode, downloadPathTemplate: string) {
	try {
		const { blob, responseUrl } = await downloadFile(episode.streamUrl);

		if (!blob.type.contains('audio')) {
			throw new Error('Not an audio file.');
		}

		await createEpisodeFile({
			episode,
			downloadPathTemplate,
			blob,
			responseUrl,
		});
	} catch (error) {
		throw new Error(`Failed to download ${episode.title}: ${error.message}`);
	}
}
