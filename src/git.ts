import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

export interface GitClient {
	run(args: string[]): Promise<GitResult>;
}

export function createGitClient(pi: ExtensionAPI, cwd: string): GitClient {
	return {
		run: (args) => pi.exec("git", args, { cwd, timeout: 120_000 }),
	};
}

export function normalizeCommitMessage(raw: string): string {
	return raw
		.trim()
		.replace(/^```(?:text)?\s*/iu, "")
		.replace(/\s*```$/u, "")
		.trim();
}

export function isConventionalCommitMessage(message: string): boolean {
	const header = message.split("\n", 1)[0] ?? "";
	return /^[a-z]+(?:\([^)\r\n]+\))?!?: \S.{2,}$/u.test(header) && header.length <= 72;
}

export function isNonFastForwardError(result: GitResult): boolean {
	const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
	return (
		output.includes("non-fast-forward") ||
		output.includes("fetch first") ||
		output.includes("remote contains work that you do not have locally") ||
		output.includes("tip of your current branch is behind")
	);
}

export async function getRepositoryRoot(git: GitClient): Promise<string | undefined> {
	const result = await git.run(["rev-parse", "--show-toplevel"]);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

export async function getCurrentBranch(git: GitClient): Promise<string | undefined> {
	const result = await git.run(["branch", "--show-current"]);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

export async function getUpstream(git: GitClient): Promise<string | undefined> {
	const result = await git.run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

export async function getConflictedFiles(git: GitClient): Promise<string[]> {
	const result = await git.run(["diff", "--name-only", "--diff-filter=U", "-z"]);
	if (result.code !== 0 || !result.stdout) return [];
	return result.stdout.split("\0").filter(Boolean);
}

export async function hasStagedChanges(git: GitClient): Promise<boolean> {
	const result = await git.run(["diff", "--cached", "--quiet"]);
	return result.code === 1;
}

export function formatGitError(result: GitResult): string {
	return (result.stderr || result.stdout || `git exited with code ${result.code}`).trim();
}
