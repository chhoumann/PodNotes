import { writable } from "svelte/store";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { DEFAULT_EPISODE_LIST_LIMIT } from "src/constants";

export { sanitizeEpisodeListLimit } from "src/utility/episodeListLimit";

export const savedFeeds = writable<{ [podcastName: string]: PodcastFeed }>({});

/**
 * How many of each feed's most recent episodes the aggregated "Latest Episodes"
 * list keeps. Backed by the `episodeListLimit` setting; `main.ts` seeds it from
 * the loaded settings and the settings tab updates it live (issue #114).
 */
export const episodeListLimit = writable<number>(DEFAULT_EPISODE_LIST_LIMIT);
