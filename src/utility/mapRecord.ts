import { ownRecord } from "./ownRecord";

export function mapRecord<T, R>(
	value: Record<string, T>,
	mapper: (entry: T) => R,
): Record<string, R> {
	const result = ownRecord<R>();
	for (const [key, entry] of Object.entries(value)) result[key] = mapper(entry);
	return result;
}
