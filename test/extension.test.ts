import assert from "node:assert/strict";
import test from "node:test";
import gitShortcuts from "../src/index.js";

test("registers command-only shortcuts without main-session side effects", async () => {
	const commands = new Map<string, unknown>();
	const tools: unknown[] = [];
	const messages: unknown[] = [];
	const entries: unknown[] = [];
	const entryRenderers = new Map<string, unknown>();
	const pi = {
		registerCommand(name: string, command: unknown) {
			commands.set(name, command);
		},
		registerTool(tool: unknown) {
			tools.push(tool);
		},
		registerEntryRenderer(type: string, renderer: unknown) {
			entryRenderers.set(type, renderer);
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

	assert.deepEqual([...commands.keys()], ["commit", "cp", "pull", "push", "git-shortcuts-config"]);
	assert.deepEqual(tools, []);
	assert.deepEqual([...entryRenderers.keys()], ["pi-git-shortcuts-result"]);
	assert.deepEqual(messages, []);
	assert.deepEqual(entries, []);
});
