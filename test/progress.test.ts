import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GitShortcutProgress, type ProgressResult, renderProgressLines } from "../src/progress.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as Theme;

test("renders compact progress steps within the available width", () => {
	const lines = renderProgressLines(
		{
			operation: "commit + push",
			startedAt: Date.now(),
			status: "running",
			steps: [
				{ label: "Staging changes", detail: "git add -A", state: "done" },
				{ label: "Generating commit message", detail: "简体中文 · 3 file(s)", state: "active" },
			],
		},
		theme,
		42,
	);

	assert.equal(lines.length, 3);
	assert.ok(lines.every((line) => visibleWidth(line) <= 42));
	assert.match(lines.join("\n"), /Generating commit message/u);
});

test("records one durable result when the operation completes", () => {
	const results: ProgressResult[] = [];
	const ctx = {
		hasUI: false,
		ui: {
			notify() {},
			setWidget() {},
		},
	};
	const progress = new GitShortcutProgress(ctx as never, "push", (result) => results.push(result));

	progress.step("Pushing current branch");
	progress.succeed("Push complete", "main -> origin/main");

	assert.equal(results.length, 1);
	assert.deepEqual(
		{ operation: results[0]?.operation, status: results[0]?.status, label: results[0]?.label },
		{ operation: "push", status: "success", label: "Push complete" },
	);
});

test("renders the final commit detail", () => {
	const lines = renderProgressLines(
		{
			operation: "commit",
			startedAt: Date.now(),
			status: "done",
			steps: [{ label: "Commit created", detail: "abc1234 feat: add progress UI", state: "done" }],
		},
		theme,
		80,
	);

	assert.match(lines.join("\n"), /abc1234 feat: add progress UI/u);
});
