import { Notice } from "obsidian";

export function TimerNotice(heading: string, initialMessage: string) {
	let currentMessage = initialMessage;
	const startTime = Date.now();
	let stopTime: number;
	let interval: number | null = null;
	let hideTimeout: number | null = null;
	let disposed = false;
	const notice = new Notice(initialMessage, 0);

	function formatMsg(message: string): string {
		return `${heading} (${getTime()}):\n\n${message}`;
	}

	function update(message: string) {
		if (disposed) return;
		currentMessage = message;
		notice.setMessage(formatMsg(currentMessage));
	}

	interval = window.setInterval(() => {
		notice.setMessage(formatMsg(currentMessage));
	}, 1000);

	function getTime(): string {
		return formatTime(stopTime ? stopTime - startTime : Date.now() - startTime);
	}

	function stop() {
		if (interval === null) return;
		stopTime = Date.now();
		window.clearInterval(interval);
		interval = null;
	}

	function scheduleHide(delayMs: number, onHide: () => void) {
		if (disposed) return;
		if (hideTimeout !== null) window.clearTimeout(hideTimeout);
		hideTimeout = window.setTimeout(() => {
			hideTimeout = null;
			dispose();
			onHide();
		}, delayMs);
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		stop();
		if (hideTimeout !== null) {
			window.clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		notice.hide();
	}

	return {
		update,
		stop,
		scheduleHide,
		dispose,
	};
}

function formatTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	return `${hours.toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
