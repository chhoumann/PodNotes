/** What the headset's and lock screen's previous-track button does, with its label in Settings. */
export const PREVIOUS_TRACK_ACTIONS = {
	captureTimestamp: "Capture timestamp",
	skipBackward: "Back by the skip length",
	previousChapter: "Previous chapter",
} as const;

/** What the headset's and lock screen's next-track button does, with its label in Settings. */
export const NEXT_TRACK_ACTIONS = {
	skipForward: "Forward by the skip length",
	nextInQueue: "Next in queue",
	nextChapter: "Next chapter",
	captureTimestamp: "Capture timestamp",
} as const;

export type PreviousTrackAction = keyof typeof PREVIOUS_TRACK_ACTIONS;
export type NextTrackAction = keyof typeof NEXT_TRACK_ACTIONS;
