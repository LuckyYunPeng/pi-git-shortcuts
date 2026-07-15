import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateCommitMessage, resolveRebaseConflicts } from "./agent.js";
import {
	createGitClient,
	formatGitError,
	type GitClient,
	type GitResult,
	getConflictedFiles,
	getCurrentBranch,
	getRepositoryRoot,
	getUpstream,
	hasStagedChanges,
	isConventionalCommitMessage,
	isNonFastForwardError,
	normalizeCommitMessage,
} from "./git.js";

interface CommitResult {
	created: boolean;
	repositoryRoot: string;
}

async function commitWithMessageFile(git: GitClient, message: string): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "pi-git-shortcuts-"));
	const messageFile = join(directory, "COMMIT_EDITMSG");
	try {
		await writeFile(messageFile, `${message.trim()}\n`, "utf8");
		const result = await git.run(["commit", "-F", messageFile]);
		if (result.code !== 0) throw new Error(formatGitError(result));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export async function commitChanges(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	instructions = "",
): Promise<CommitResult | undefined> {
	let git = createGitClient(pi, ctx.cwd);
	const repositoryRoot = await getRepositoryRoot(git);
	if (!repositoryRoot) {
		ctx.ui.notify("pi-git-shortcuts: not inside a Git repository", "error");
		return undefined;
	}
	git = createGitClient(pi, repositoryRoot);

	const addResult = await git.run(["add", "-A"]);
	if (addResult.code !== 0) {
		ctx.ui.notify(`pi-git-shortcuts: git add failed\n${formatGitError(addResult)}`, "error");
		return undefined;
	}
	if (!(await hasStagedChanges(git))) {
		ctx.ui.notify("pi-git-shortcuts: nothing to commit", "info");
		return { created: false, repositoryRoot };
	}

	const [statResult, diffResult] = await Promise.all([
		git.run(["diff", "--cached", "--stat"]),
		git.run(["diff", "--cached", "--no-ext-diff"]),
	]);
	if (statResult.code !== 0 || diffResult.code !== 0) {
		ctx.ui.notify("pi-git-shortcuts: unable to read the staged diff", "error");
		return undefined;
	}

	ctx.ui.notify("pi-git-shortcuts: generating commit message...", "info");
	let message: string;
	try {
		message = normalizeCommitMessage(
			await generateCommitMessage(
				ctx,
				repositoryRoot,
				statResult.stdout,
				diffResult.stdout,
				instructions,
			),
		);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`pi-git-shortcuts: commit message generation failed\n${detail}`, "error");
		return undefined;
	}

	if (!isConventionalCommitMessage(message)) {
		ctx.ui.notify(
			`pi-git-shortcuts: model returned an invalid commit message\n${message}`,
			"error",
		);
		return undefined;
	}

	try {
		await commitWithMessageFile(git, message);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`pi-git-shortcuts: commit failed\n${detail}`, "error");
		return undefined;
	}

	const logResult = await git.run(["log", "-1", "--format=%h %s"]);
	ctx.ui.notify(`pi-git-shortcuts: committed ${logResult.stdout.trim()}`, "info");
	return { created: true, repositoryRoot };
}

async function pushCurrentBranch(git: GitClient): Promise<Awaited<ReturnType<GitClient["run"]>>> {
	const upstream = await getUpstream(git);
	if (upstream) return git.run(["push"]);

	const branch = await getCurrentBranch(git);
	if (!branch) throw new Error("cannot push a detached HEAD");
	const origin = await git.run(["remote", "get-url", "origin"]);
	if (origin.code !== 0) throw new Error("no upstream branch and no origin remote");
	return git.run(["push", "-u", "origin", branch]);
}

async function continueRebaseWithConflictResolution(
	git: GitClient,
	ctx: ExtensionContext,
	repositoryRoot: string,
): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const conflictedFiles = await getConflictedFiles(git);
		if (conflictedFiles.length === 0) return;

		ctx.ui.notify(
			`pi-git-shortcuts: resolving ${conflictedFiles.length} rebase conflict(s)...`,
			"warning",
		);
		await resolveRebaseConflicts(ctx, repositoryRoot, conflictedFiles);

		const remainingMarkers = await git.run([
			"grep",
			"-n",
			"-e",
			"^<<<<<<< ",
			"-e",
			"^=======$",
			"-e",
			"^>>>>>>> ",
			"--",
			...conflictedFiles,
		]);
		if (remainingMarkers.code === 0 && remainingMarkers.stdout.trim()) {
			throw new Error(`conflict markers remain:\n${remainingMarkers.stdout.trim()}`);
		}

		const addResult = await git.run(["add", "--", ...conflictedFiles]);
		if (addResult.code !== 0) throw new Error(formatGitError(addResult));
		const continueResult = await git.run(["-c", "core.editor=true", "rebase", "--continue"]);
		if (continueResult.code === 0) continue;
		if ((await getConflictedFiles(git)).length === 0)
			throw new Error(formatGitError(continueResult));
	}

	throw new Error("rebase exceeded 20 conflict-resolution rounds");
}

async function rebaseFromUpstream(
	git: GitClient,
	ctx: ExtensionContext,
	repositoryRoot: string,
): Promise<void> {
	const upstream = await getUpstream(git);
	let pullResult: GitResult;
	if (upstream) {
		pullResult = await git.run(["pull", "--rebase"]);
	} else {
		const branch = await getCurrentBranch(git);
		if (!branch) throw new Error("cannot rebase a detached HEAD");
		pullResult = await git.run(["pull", "--rebase", "origin", branch]);
	}
	if (pullResult.code === 0) return;
	if ((await getConflictedFiles(git)).length === 0) throw new Error(formatGitError(pullResult));
	await continueRebaseWithConflictResolution(git, ctx, repositoryRoot);
}

export async function commitAndPush(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	instructions = "",
): Promise<void> {
	const commitResult = await commitChanges(pi, ctx, instructions);
	if (!commitResult) return;

	const git = createGitClient(pi, commitResult.repositoryRoot);
	ctx.ui.notify("pi-git-shortcuts: pushing current branch...", "info");
	let pushResult: Awaited<ReturnType<GitClient["run"]>>;
	try {
		pushResult = await pushCurrentBranch(git);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`pi-git-shortcuts: push failed\n${detail}`, "error");
		return;
	}

	if (pushResult.code === 0) {
		ctx.ui.notify("pi-git-shortcuts: push complete", "info");
		return;
	}
	if (!isNonFastForwardError(pushResult)) {
		ctx.ui.notify(`pi-git-shortcuts: push failed\n${formatGitError(pushResult)}`, "error");
		return;
	}

	ctx.ui.notify("pi-git-shortcuts: remote is ahead; rebasing...", "warning");
	try {
		await rebaseFromUpstream(git, ctx, commitResult.repositoryRoot);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(
			`pi-git-shortcuts: automatic rebase resolution failed\n${detail}\nThe rebase was left in progress for manual recovery.`,
			"error",
		);
		return;
	}

	const retryResult = await pushCurrentBranch(git);
	if (retryResult.code !== 0) {
		ctx.ui.notify(
			`pi-git-shortcuts: push failed after rebase\n${formatGitError(retryResult)}`,
			"error",
		);
		return;
	}
	ctx.ui.notify("pi-git-shortcuts: rebase and push complete", "info");
}
