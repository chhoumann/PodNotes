import "@testing-library/jest-dom";

const months = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

function formatDate(date: Date, pattern: string): string {
	const pad = (value: number) => value.toString().padStart(2, "0");
	const year = date.getUTCFullYear();
	const monthIndex = date.getUTCMonth();
	const day = date.getUTCDate();
	const hours = date.getUTCHours();
	const minutes = date.getUTCMinutes();
	const seconds = date.getUTCSeconds();

	return pattern
		.replace("YYYY", year.toString())
		.replace("MMMM", months[monthIndex])
		.replace("MM", pad(monthIndex + 1))
		.replace("DD", pad(day))
		.replace("HH", pad(hours))
		.replace("mm", pad(minutes))
		.replace("ss", pad(seconds));
}

function createMoment(dateInput?: Date | string | number) {
	let date =
		dateInput instanceof Date
			? new Date(dateInput)
			: dateInput
				? new Date(dateInput)
				: new Date();

	const api = {
		format: (pattern: string = "YYYY-MM-DD") => formatDate(date, pattern),
		startOf: (unit?: string) => {
			if (unit === "day") {
				date = new Date(
					date.getFullYear(),
					date.getMonth(),
					date.getDate(),
					0,
					0,
					0,
					0,
				);
			}

			return api;
		},
		seconds: (seconds: number) => {
			const updated = new Date(date);
			updated.setSeconds(seconds);
			updated.setMilliseconds(0);
			date = updated;
			return api;
		},
	};

	return api;
}

(window as unknown as { moment: typeof createMoment }).moment = createMoment;

if (typeof IntersectionObserver === "undefined") {
	class MockIntersectionObserver implements IntersectionObserver {
		constructor(
			private callback: IntersectionObserverCallback,
			private _options?: IntersectionObserverInit,
		) {}

		readonly root: Element | Document | null = null;
		readonly rootMargin: string = this._options?.rootMargin ?? "0px";
		readonly thresholds: ReadonlyArray<number> = [0];

		disconnect(): void {}

		observe(target: Element): void {
			this.callback(
				[
					{
						isIntersecting: true,
						target,
						intersectionRatio: 1,
						boundingClientRect: target.getBoundingClientRect(),
						intersectionRect: target.getBoundingClientRect(),
						rootBounds: null,
						time: 0,
					} as IntersectionObserverEntry,
				],
				this,
			);
		}

		takeRecords(): IntersectionObserverEntry[] {
			return [];
		}

		unobserve(): void {}
	}

	(globalThis as unknown as { IntersectionObserver: typeof MockIntersectionObserver })
		.IntersectionObserver = MockIntersectionObserver;
}

if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}

if (!(HTMLElement.prototype as unknown as { setAttr?: (name: string, value: string) => void }).setAttr) {
	(HTMLElement.prototype as unknown as { setAttr: (name: string, value: string) => void }).setAttr =
		function (this: HTMLElement, name: string, value: string) {
			this.setAttribute(name, value);
		};
}
