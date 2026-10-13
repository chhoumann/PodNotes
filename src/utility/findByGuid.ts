/** The only item with this guid. Undefined for a missing guid, no match, or several matches. */
export function findByGuid<T extends { guid?: string }>(
	items: readonly T[],
	guid: string | undefined,
): T | undefined {
	if (!guid) return undefined;
	const matches = items.filter((item) => item.guid === guid);
	return matches.length === 1 ? matches[0] : undefined;
}
