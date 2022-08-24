import { htmlToMarkdown, Notice } from "obsidian";
import { Episode } from "src/types/Episode";
import Fuse from "fuse.js";
import { plugin } from "src/store";
import { get } from "svelte/store";
import getUrlExtension from "./utility/getUrlExtension";

interface Tags {
	[tag: string]: string | ((...args: unknown[]) => string);
}

function TemplateEngine(template: string, tags: Tags) {
	return template.replace(/\{\{(.*?)(:\s*?.+?)?\}\}/g, (match: string, tagId: string, params: string) => {
		const tagValue = tags[tagId.toLowerCase()];
		if (tagValue === null || tagValue === undefined) {
			const fuse = new Fuse(Object.keys(tags), {
				shouldSort: true,
				findAllMatches: false,
				threshold: 0.4,
				isCaseSensitive: false,
			});

			const similarTag = fuse.search(tagId);

			new Notice(`Tag ${tagId} is invalid.${similarTag.length > 0 ? ` Did you mean ${similarTag[0].item}?` : ""}`);
			return match;
		}

		if (typeof tagValue === 'function') {
			if (params) {
				// Remove initial colon with splice.
				const splitParams = params.slice(1).split(',');
				const args = Array.isArray(splitParams) ? splitParams : [params];
				
				return tagValue(...args);
			}

			return tagValue();
		}
		
		return tagValue;
	});
}

export function NoteTemplateEngine(template: string, episode: Episode) {
	return TemplateEngine(template, {
		"title": episode.title,
		"description": (prependToLines?: string) => {
			if (prependToLines) {
				return htmlToMarkdown(episode.description)
					.split("\n")
					.map(prepend(prependToLines))
					.join("\n")
			}

			return htmlToMarkdown(episode.description)
		},
		"url": episode.url,
		"date": (format?: string) => episode.episodeDate ?
			window.moment(episode.episodeDate).format(format ?? "YYYY-MM-DD")
			: "",
		"podcast": episode.podcastName,
		"artwork": episode.artworkUrl ?? "",
	});
}

function prepend(prepend: string) {
	return (str: string) => `${prepend}${str}`;
}

export function TimestampTemplateEngine(template: string) {
	return TemplateEngine(template, {
		"time": (format?: string) => get(plugin).api.getPodcastTimeFormatted(format ?? "HH:mm:ss"),
		"linktime": (format?: string) => get(plugin).api.getPodcastTimeFormatted(format ?? "HH:mm:ss", true),
	});
}

export function FilePathTemplateEngine(template: string, episode: Episode) {
	return TemplateEngine(template, {
		"title": replaceIllegalFileNameCharactersInString(episode.title),
		"podcast": replaceIllegalFileNameCharactersInString(episode.podcastName),
	});
}

export function DownloadPathTemplateEngine(template: string, episode: Episode) {
	// Removing the template extension, as this is added automatically depending on file type.
	const templateExtension = getUrlExtension(template);
	const templateWithoutExtension = templateExtension ?
		template.replace(templateExtension, '') :
		template;

	return TemplateEngine(templateWithoutExtension, {
		"title": replaceIllegalFileNameCharactersInString(episode.title),
		"podcast": replaceIllegalFileNameCharactersInString(episode.podcastName),
	});
}

function replaceIllegalFileNameCharactersInString(string: string) {
    return string
        .replace(/[\\,#%&{}/*<>$'":@\u2023|?]*/g, '') // Replace illegal file name characters with empty string
        .replace(/\n/, ' ') // replace newlines with spaces
        .replace('  ', ' '); // replace multiple spaces with single space to make sure we don't have double spaces in the file name
}
