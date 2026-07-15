import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateCommitMessage, resolveRebaseConflicts } from "./agent.js";
import { type CommitLanguage, commitLanguageInstruction } from "./config.js";
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
import { GitShortcutProgress, type ProgressState } from "./progress.js";
import { appendResult } from "./result.js";

interface CommitResult {
	created: boolean;
	repositoryRoot: string;
}

function createProgress(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	operation: ProgressState["operation"],
): GitShortcutProgress {
	return new GitShortcutProgress(ctx, operation, (result) => appendResult(pi, result));
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
	commitLanguage: CommitLanguage = "english",
	progress = createProgress(pi, ctx, "commit"),
	finalizeProgress = true,
): Promise<CommitResult | undefined> {
	progress.step("Checking repository");
	let git = createGitClient(pi, ctx.cwd);
	const repositoryRoot = await getRepositoryRoot(git);
	if (!repositoryRoot) {
		progress.fail("Not inside a Git repository");
		return undefined;
	}
	git = createGitClient(pi, repositoryRoot);

	progress.step("Staging changes", "git add -A");
	const addResult = await git.run(["add", "-A"]);
	if (addResult.code !== 0) {
		progress.fail("Unable to stage changes", formatGitError(addResult));
		return undefined;
	}
	if (!(await hasStagedChanges(git))) {
		if (finalizeProgress) progress.succeed("Nothing to commit", "working tree is clean");
		else progress.step("No new commit needed", "working tree is clean");
		return { created: false, repositoryRoot };
	}

	progress.step("Reading staged diff");
	const [statResult, diffResult, filesResult] = await Promise.all([
		git.run(["diff", "--cached", "--stat"]),
		git.run(["diff", "--cached", "--no-ext-diff"]),
		git.run(["diff", "--cached", "--name-only"]),
	]);
	if (statResult.code !== 0 || diffResult.code !== 0) {
		progress.fail("Unable to read the staged diff");
		return undefined;
	}

	const fileCount = filesResult.stdout.split("\n").filter(Boolean).length;
	const languageLabel = commitLanguage === "chinese" ? "简体中文" : "English";
	progress.step("Generating commit message", `${languageLabel} · ${fileCount} file(s)`);
	let message: string;
	try {
		message = normalizeCommitMessage(
			await generateCommitMessage(
				ctx,
				repositoryRoot,
				statResult.stdout,
				diffResult.stdout,
				instructions,
				commitLanguageInstruction(commitLanguage),
			),
		);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		progress.fail("Commit message generation failed", detail);
		return undefined;
	}

	if (!isConventionalCommitMessage(message)) {
		progress.fail("Model returned an invalid commit message", message);
		return undefined;
	}

	const summary = message.split("\n", 1)[0] ?? message;
	progress.step("Creating commit", summary);
	try {
		await commitWithMessageFile(git, message);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		progress.fail("Commit failed", detail);
		return undefined;
	}

	const logResult = await git.run(["log", "-1", "--format=%h %s"]);
	if (finalizeProgress) progress.succeed("Commit created", logResult.stdout.trim());
	else progress.step("Commit created", logResult.stdout.trim());
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
	progress: GitShortcutProgress,
): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const conflictedFiles = await getConflictedFiles(git);
		if (conflictedFiles.length === 0) return;

		progress.warning(
			"Resolving rebase conflicts",
			`${conflictedFiles.length} file(s) · round ${attempt + 1}`,
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
	progress: GitShortcutProgress,
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
	await continueRebaseWithConflictResolution(git, ctx, repositoryRoot, progress);
}

async function pushRepository(
	git: GitClient,
	ctx: ExtensionContext,
	repositoryRoot: string,
	progress: GitShortcutProgress,
): Promise<void> {
	progress.step("Pushing current branch");
	let pushResult: Awaited<ReturnType<GitClient["run"]>>;
	try {
		pushResult = await pushCurrentBranch(git);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		progress.fail("Push failed", detail);
		return;
	}

	if (pushResult.code === 0) {
		progress.succeed("Push complete");
		return;
	}
	if (!isNonFastForwardError(pushResult)) {
		progress.fail("Push failed", formatGitError(pushResult));
		return;
	}

	progress.warning("Remote branch is ahead", "starting rebase");
	progress.step("Rebasing onto upstream");
	try {
		await rebaseFromUpstream(git, ctx, repositoryRoot, progress);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		progress.fail(
			"Automatic rebase resolution failed",
			`${detail}\nRebase left in progress for manual recovery.`,
		);
		return;
	}

	progress.step("Retrying push after rebase");
	const retryResult = await pushCurrentBranch(git);
	if (retryResult.code !== 0) {
		progress.fail("Push failed after rebase", formatGitError(retryResult));
		return;
	}
	progress.succeed("Rebase and push complete");
}

export async function pushChanges(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const progress = createProgress(pi, ctx, "push");
	progress.step("Checking repository");
	let git = createGitClient(pi, ctx.cwd);
	const repositoryRoot = await getRepositoryRoot(git);
	if (!repositoryRoot) {
		progress.fail("Not inside a Git repository");
		return;
	}

	git = createGitClient(pi, repositoryRoot);
	await pushRepository(git, ctx, repositoryRoot, progress);
}

export async function commitAndPush(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	instructions = "",
	commitLanguage: CommitLanguage = "english",
): Promise<void> {
	const progress = createProgress(pi, ctx, "commit + push");
	const commitResult = await commitChanges(pi, ctx, instructions, commitLanguage, progress, false);
	if (!commitResult) return;

	const git = createGitClient(pi, commitResult.repositoryRoot);
	await pushRepository(git, ctx, commitResult.repositoryRoot, progress);
}
