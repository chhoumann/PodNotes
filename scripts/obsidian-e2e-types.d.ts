import type { Dirent } from "node:fs";

export interface ProvisionRawOptions {
	data?: string;
	force?: boolean;
	help?: boolean;
	json?: boolean;
	printEnv?: boolean;
	root?: string;
	vault?: string;
	worktree?: string;
}

export interface ProvisionOptions {
	dataPath: string | undefined;
	force: boolean;
	json: boolean;
	printEnv: boolean;
	rootPath: string;
	vaultName: string;
	vaultPath: string;
	worktreePath: string;
}

export interface ProvisionResult {
	pluginPath: string;
	vaultName: string;
	vaultPath: string;
	worktreePath: string;
}

export interface InstanceRawOptions extends ProvisionRawOptions {
	launch?: boolean;
	obsidianApp?: string;
	obsidianBin?: string;
	profileRoot?: string;
}

export interface InstanceOptions extends ProvisionOptions {
	instanceId: string;
	instancePath: string;
	launch: boolean;
	obsidianApp: string;
	obsidianBin: string;
	obsidianHome: string;
	profileRoot: string;
	userDataPath: string;
}

export interface ProfileResult {
	obsidianJsonPath: string;
	userDataPath: string;
	vaultId: string;
}

export interface LaunchResult {
	pid: null;
	pidPath: null;
}

export interface InstanceShellResult {
	obsidianBin?: string;
	obsidianHome: string;
	vaultName: string;
	vaultPath: string;
}

export interface WrapperArgs {
	commandArgs: string[];
	help: boolean;
	instanceArgs: string[];
}

export interface ProcessInfo {
	command: string;
	pid: number;
	ppid: number;
}

export interface CollectInstanceOptions {
	selfPid?: number;
}

export type KillFunction = (pid: number, signal: NodeJS.Signals | 0) => void;
export type RunPsFunction = () => Promise<string>;
export type RemoveDirFunction = (dir: string) => Promise<void>;
export type ReadFileFunction = (file: string) => Promise<string>;
export type ExistsFunction = (target: string) => Promise<boolean>;

export interface StopOptions {
	dryRun?: boolean;
	graceMs?: number;
	kill?: KillFunction;
	pollMs?: number;
	profileRoot?: string;
	removeDir?: RemoveDirFunction;
	runPs?: RunPsFunction;
	selfPid?: number;
}

export interface StopResult {
	instancePath: string;
	killed: number[];
	pids: number[];
	removed: boolean;
	terminated: number[];
}

export interface InstanceReadDependencies {
	exists?: ExistsFunction;
	readFile?: ReadFileFunction;
}

export interface ReapOptions extends StopOptions, InstanceReadDependencies {
	exceptInstancePath?: string;
	log?: (message: string) => void;
	profileRoot?: string;
	readdir?: (dir: string) => Promise<Dirent[]>;
}

export interface ReapResult {
	reaped: string[];
	scanned: number;
}

export interface StopRawOptions extends InstanceRawOptions {
	dryRun: boolean;
	json: boolean;
	prune: boolean;
}
