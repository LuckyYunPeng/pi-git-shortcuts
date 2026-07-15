import assert from "node:assert/strict";
import test from "node:test";
import {
	type GitResult,
	isConventionalCommitMessage,
	isNonFastForwardError,
	normalizeCommitMessage,
} from "../src/git.js";

function result(stderr: string): GitResult {
	return { stdout: "", stderr, code: 1, killed: false };
}

test("normalizes fenced commit messages", () => {
	assert.equal(
		normalizeCommitMessage("```text\nfeat(git): add commit shortcut\n```"),
		"feat(git): add commit shortcut",
	);
});

test("validates conventional commit headers", () => {
	assert.equal(isConventionalCommitMessage("feat(git): add commit shortcut"), true);
	assert.equal(isConventionalCommitMessage("fix!: preserve rebase state"), true);
	assert.equal(isConventionalCommitMessage("update git shortcut"), false);
	assert.equal(isConventionalCommitMessage(`feat: ${"x".repeat(80)}`), false);
});

test("recognizes non-fast-forward push failures", () => {
	assert.equal(isNonFastForwardError(result("! [rejected] main -> main (fetch first)")), true);
	assert.equal(
		isNonFastForwardError(
			result("Updates were rejected because the remote contains work that you do not have locally"),
		),
		true,
	);
	assert.equal(isNonFastForwardError(result("error: failed to push some refs")), false);
	assert.equal(isNonFastForwardError(result("fatal: authentication failed")), false);
});
