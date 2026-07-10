declare module "@semantic-release/commit-analyzer" {
	type ReleaseType = "major" | "minor" | "patch";

	type ReleaseCommit = {
		authorDate: string;
		authorEmail: string;
		authorName: string;
		committerDate: string;
		gitTags: string;
		hash: string;
		message: string;
	};

	type ReleaseLogger = {
		error(...arguments_: unknown[]): void;
		log(...arguments_: unknown[]): void;
		success(...arguments_: unknown[]): void;
		warn(...arguments_: unknown[]): void;
	};

	export function analyzeCommits(
		pluginConfig: {
			releaseRules: Array<{
				release: ReleaseType;
				scope?: string;
				type: string;
			}>;
		},
		context: {
			commits: ReleaseCommit[];
			cwd: string;
			logger: ReleaseLogger;
		},
	): Promise<ReleaseType | null>;
}

declare module "@semantic-release/release-notes-generator" {
	import type {
		ReleaseCommit,
		ReleaseLogger,
		ReleaseType,
	} from "@semantic-release/commit-analyzer";

	export function generateNotes(
		pluginConfig: {
			writerOpts?: {
				finalizeContext(context: Record<string, unknown>): Record<string, unknown>;
			};
		},
		context: {
			commits: ReleaseCommit[];
			cwd: string;
			lastRelease: {
				gitHead: string;
				gitTag: string;
				version: string;
			};
			logger: ReleaseLogger;
			nextRelease: {
				gitHead: string;
				gitTag: string;
				type: ReleaseType;
				version: string;
			};
			options: { repositoryUrl: string };
		},
	): Promise<string>;
}
