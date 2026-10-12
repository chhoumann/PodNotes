export function ownRecord<T>(entries?: Readonly<Record<string, T>>): Record<string, T> {
	return Object.assign(Object.create(null) as Record<string, T>, entries);
}
