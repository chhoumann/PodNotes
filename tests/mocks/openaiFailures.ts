const openAIError = (status: number, message: string) => async () =>
	Response.json({ error: { message, type: "error", param: null, code: null } }, { status });

type Failure = [name: string, respond: () => Promise<Response>, message: string];

/** Failures that sending the same request again can get past. */
export const OPENAI_FAILURES: Failure[] = [
	[
		"429",
		openAIError(
			429,
			"You exceeded your current quota, please check your plan and billing details.",
		),
		"429 You exceeded your current quota, please check your plan and billing details.",
	],
	[
		"500",
		openAIError(
			500,
			"The server had an error while processing your request. Sorry about that!",
		),
		"500 The server had an error while processing your request. Sorry about that!",
	],
	["502 text body", async () => new Response("Bad Gateway", { status: 502 }), "502 Bad Gateway"],
	["503 empty body", async () => new Response("", { status: 503 }), "503 status code (no body)"],
	["network", () => Promise.reject(new TypeError("Failed to fetch")), "Connection error."],
];

/** Failures that the same request always gets again. */
export const OPENAI_REJECTIONS: Failure[] = [
	[
		"400",
		openAIError(
			400,
			"audio duration 1520.592 seconds is longer than 1400 seconds which is the maximum for this model",
		),
		"400 audio duration 1520.592 seconds is longer than 1400 seconds which is the maximum for this model",
	],
	[
		"401",
		openAIError(
			401,
			"Incorrect API key provided: sk-test. You can find your API key at https://platform.openai.com/account/api-keys.",
		),
		"401 Incorrect API key provided: sk-test. You can find your API key at https://platform.openai.com/account/api-keys.",
	],
];

export const rateLimited = (headers: Record<string, string>) =>
	Response.json(
		{
			error: {
				message: "Rate limit reached for requests.",
				type: "requests",
				param: null,
				code: "rate_limit_exceeded",
			},
		},
		{ status: 429, headers },
	);
