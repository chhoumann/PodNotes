import { Notice } from "obsidian";

export function TimerNotice(heading: string, initialMessage: string) {
	let currentMessage = initialMessage;
	const startTime = Date.now();
	let stopTime: number | undefined;
	let hideTimeout: number | undefined;
	let disposed = false;
	const notice = new Notice(initialMessage, 0);

	function render() {
		const elapsed = formatTime((stopTime ?? Date.now()) - startTime);
		notice.setMessage(`${heading} (${elapsed}):\n\n${currentMessage}`);
	}

	function update(message: string) {
		if (disposed) return;
		currentMessage = message;
		render();
	}

	const interval = window.setInterval(render, 1000);

	function stop() {
		if (stopTime !== undefined) return;
		stopTime = Date.now();
		window.clearInterval(interval);
	}

	function scheduleHide(delayMs: number, onHide: () => void) {
		if (disposed) return;
		window.clearTimeout(hideTimeout);
		hideTimeout = window.setTimeout(() => {
			dispose();
			onHide();
		}, delayMs);
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		stop();
		window.clearTimeout(hideTimeout);
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
