const openAIError = (status: number, message: string) => async () =>
	Response.json({ error: { message, type: "error", param: null, code: null } }, { status });

export const OPENAI_FAILURES: [name: string, respond: () => Promise<Response>, message: string][] =
	[
		[
			"401",
			openAIError(
				401,
				"Incorrect API key provided: sk-test. You can find your API key at https://platform.openai.com/account/api-keys.",
			),
			"401 Incorrect API key provided: sk-test. You can find your API key at https://platform.openai.com/account/api-keys.",
		],
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
		[
			"502 text body",
			async () => new Response("Bad Gateway", { status: 502 }),
			"502 Bad Gateway",
		],
		[
			"503 empty body",
			async () => new Response("", { status: 503 }),
			"503 status code (no body)",
		],
		["network", () => Promise.reject(new TypeError("Failed to fetch")), "Connection error."],
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
