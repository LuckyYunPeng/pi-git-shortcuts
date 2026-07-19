import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	commitLanguageInstruction,
	normalizeConfig,
	readConfig,
	writeConfig,
} from "../src/config.js";

test("uses English and the active model by default", () => {
	assert.deepEqual(normalizeConfig(undefined), { commitLanguage: "english" });
	assert.deepEqual(normalizeConfig({ commitLanguage: "invalid", model: "  " }), {
		commitLanguage: "english",
	});
	assert.deepEqual(normalizeConfig({ model: " openai/gpt-5 " }), {
		commitLanguage: "english",
		model: "openai/gpt-5",
	});
});

test("reads and atomically writes the selected language", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-git-shortcuts-config-"));
	const configPath = join(directory, "nested", "pi-git-shortcuts.json");
	try {
		await writeConfig({ commitLanguage: "chinese", model: "google/gemini-2.5-flash" }, configPath);
		assert.deepEqual(await readConfig(configPath), {
			commitLanguage: "chinese",
			model: "google/gemini-2.5-flash",
		});
		assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
			commitLanguage: "chinese",
			model: "google/gemini-2.5-flash",
		});

		await writeFile(configPath, "not-json", "utf8");
		assert.deepEqual(await readConfig(configPath), { commitLanguage: "english" });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("builds explicit language instructions for the isolated agent", () => {
	assert.match(commitLanguageInstruction("english"), /entire commit message in English/u);
	assert.match(commitLanguageInstruction("chinese"), /Simplified Chinese/u);
	assert.match(commitLanguageInstruction("chinese"), /type and optional scope in English/u);
});
