export const PREVIOUS_TRACK_ACTIONS = {
	captureTimestamp: "Capture timestamp",
	skipBackward: "Back by the skip length",
	previousChapter: "Previous chapter",
} as const;

export const NEXT_TRACK_ACTIONS = {
	skipForward: "Forward by the skip length",
	nextInQueue: "Next in queue",
	nextChapter: "Next chapter",
	captureTimestamp: "Capture timestamp",
} as const;

export type PreviousTrackAction = keyof typeof PREVIOUS_TRACK_ACTIONS;
export type NextTrackAction = keyof typeof NEXT_TRACK_ACTIONS;
