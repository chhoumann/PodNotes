import { get } from "svelte/store";
import type { FeedRepository } from "src/services/FeedRepository";
import { publicFeedUrl } from "src/services/privateFeeds";
import type { Episode } from "src/types/Episode";
import { isFetchableUrl } from "src/utility/assertFetchableUrl";
import { isCredentialBearingUrl } from "src/utility/privateFeedUrl";

declare const publicAudio: unique symbol;

/**
 * An enclosure address that a provider may be given. Only `publicAudioUrl` makes one, so a
 * private feed's address or a local path reaches no request without a cast.
 */
export type PublicAudioUrl = string & { readonly [publicAudio]: true };

/**
 * The episode's address when a provider may fetch it, which takes all of:
 *
 * - a saved public feed lists exactly this address as an item's enclosure. A private feed's
 *   episode never passes, even with a clean-looking address, because publishers put the
 *   subscriber's token in the path. Neither does a local file, which no feed lists;
 * - the address carries no credential or signed-URL parameter and names a public http(s) host.
 *
 * Anything else resolves undefined and is uploaded, which is always correct.
 */
/**
 * A query parameter that signs a URL: AWS and Google Cloud's X-Amz- and X-Goog- credential,
 * signature and token, and Akamai's hdnts and hdnea tokens. Matched within the name, so an unknown scheme's
 * signature uploads the audio.
 */
const SIGNED_URL_PARAM = /signature|credential|token|^hdn(ts|ea)$/i;

const isSignedUrl = (address: string): boolean =>
	[...new URL(address).searchParams.keys()].some((name) => SIGNED_URL_PARAM.test(name));

export async function publicAudioUrl(
	episode: Episode,
	feeds: Pick<FeedRepository, "load" | "subscribe">,
): Promise<PublicAudioUrl | undefined> {
	const key = episode.podcastName;
	const address = episode.streamUrl;
	/** Undefined when the episode has no saved public feed. */
	const listed = (): boolean | undefined => {
		const state = get(feeds).get(key);
		if (!state || !publicFeedUrl(state.feed)) return undefined;
		return state.episodes.some((item) => item.streamUrl === address);
	};

	if (isCredentialBearingUrl(address) || !isFetchableUrl(address) || isSignedUrl(address))
		return undefined;
	if (listed() === undefined) return undefined;
	const loaded = await feeds.load([key], "cached");
	// The cache keeps a long feed's newest items, so an older episode needs the whole feed.
	if (listed() === false && loaded) await feeds.load([key], "complete");
	return listed() ? (address as PublicAudioUrl) : undefined;
}
