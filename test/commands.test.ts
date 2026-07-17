import assert from "node:assert/strict";
import test from "node:test";
import { pullChanges } from "../src/commands.js";
import type { GitResult } from "../src/git.js";

function result(stdout = "", stderr = "", code = 0): GitResult {
	return { stdout, stderr, code, killed: false };
}

function createHarness(responses: Map<string, GitResult>) {
	const calls: string[][] = [];
	const entries: Array<{ type: string; data: unknown }> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const pi = {
		exec(_command: string, args: string[]) {
			calls.push(args);
			const key = args.join("\0");
			return Promise.resolve(
				responses.get(key) ?? result("", `unexpected git command: ${args.join(" ")}`, 1),
			);
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type, data });
		},
	};
	const ctx = {
		cwd: "/repo/subdirectory",
		hasUI: false,
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
			setWidget() {},
		},
	};
	return { calls, ctx, entries, notifications, pi };
}

test("pulls and rebases the configured upstream", async () => {
	const harness = createHarness(
		new Map([
			["rev-parse\0--show-toplevel", result("/repo\n")],
			["rev-parse\0--abbrev-ref\0--symbolic-full-name\0@{u}", result("origin/main\n")],
			["pull\0--rebase", result("Already up to date.\n")],
		]),
	);

	await pullChanges(harness.pi as never, harness.ctx as never);

	assert.deepEqual(harness.calls.at(-1), ["pull", "--rebase"]);
	assert.equal(harness.entries.length, 1);
	assert.match(JSON.stringify(harness.entries[0]?.data), /Pull complete/u);
});

test("pulls the matching origin branch when no upstream is configured", async () => {
	const harness = createHarness(
		new Map([
			["rev-parse\0--show-toplevel", result("/repo\n")],
			["rev-parse\0--abbrev-ref\0--symbolic-full-name\0@{u}", result("", "no upstream", 128)],
			["branch\0--show-current", result("feature/pull\n")],
			["pull\0--rebase\0origin\0feature/pull", result()],
		]),
	);

	await pullChanges(harness.pi as never, harness.ctx as never);

	assert.deepEqual(harness.calls.at(-1), ["pull", "--rebase", "origin", "feature/pull"]);
	assert.match(JSON.stringify(harness.entries[0]?.data), /Pull complete/u);
});

test("reports a normal pull failure without claiming a rebase is in progress", async () => {
	const harness = createHarness(
		new Map([
			["rev-parse\0--show-toplevel", result("/repo\n")],
			["rev-parse\0--abbrev-ref\0--symbolic-full-name\0@{u}", result("origin/main\n")],
			["pull\0--rebase", result("", "cannot pull with rebase: You have unstaged changes.", 128)],
			["diff\0--name-only\0--diff-filter=U\0-z", result()],
		]),
	);

	await pullChanges(harness.pi as never, harness.ctx as never);

	assert.match(harness.notifications[0]?.message ?? "", /Pull failed/u);
	assert.doesNotMatch(harness.notifications[0]?.message ?? "", /left in progress/u);
});

test("rejects pulling without an upstream from a detached HEAD", async () => {
	const harness = createHarness(
		new Map([
			["rev-parse\0--show-toplevel", result("/repo\n")],
			["rev-parse\0--abbrev-ref\0--symbolic-full-name\0@{u}", result("", "no upstream", 128)],
			["branch\0--show-current", result()],
		]),
	);

	await pullChanges(harness.pi as never, harness.ctx as never);

	assert.match(harness.notifications[0]?.message ?? "", /cannot rebase a detached HEAD/u);
});
