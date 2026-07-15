import assert from "node:assert/strict";
import test from "node:test";
import gitShortcuts from "../src/index.js";

test("registers command-only shortcuts without main-session side effects", async () => {
	const commands = new Map<string, unknown>();
	const tools: unknown[] = [];
	const messages: unknown[] = [];
	const entries: unknown[] = [];
	const pi = {
		registerCommand(name: string, command: unknown) {
			commands.set(name, command);
		},
		registerTool(tool: unknown) {
			tools.push(tool);
		},
		sendUserMessage(message: unknown) {
			messages.push(message);
		},
		sendMessage(message: unknown) {
			messages.push(message);
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type, data });
		},
	};

	await gitShortcuts(pi as never);

	assert.deepEqual([...commands.keys()], ["commit", "cp", "push", "git-shortcuts-config"]);
	assert.deepEqual(tools, []);
	assert.deepEqual(messages, []);
	assert.deepEqual(entries, []);
});
