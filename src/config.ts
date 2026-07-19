import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type CommitLanguage = "english" | "chinese";

export interface GitShortcutsConfig {
	commitLanguage: CommitLanguage;
	model?: string;
}

export const DEFAULT_CONFIG: GitShortcutsConfig = {
	commitLanguage: "english",
};

export function getConfigPath(): string {
	return join(getAgentDir(), "pi-git-shortcuts.json");
}

export function normalizeConfig(value: unknown): GitShortcutsConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CONFIG };
	const config = value as { commitLanguage?: unknown; model?: unknown };
	return {
		commitLanguage:
			config.commitLanguage === "chinese" || config.commitLanguage === "english"
				? config.commitLanguage
				: "english",
		...(typeof config.model === "string" && config.model.trim()
			? { model: config.model.trim() }
			: {}),
	};
}

export async function readConfig(configPath = getConfigPath()): Promise<GitShortcutsConfig> {
	try {
		return normalizeConfig(JSON.parse(await readFile(configPath, "utf8")));
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export async function writeConfig(
	config: GitShortcutsConfig,
	configPath = getConfigPath(),
): Promise<void> {
	await mkdir(dirname(configPath), { recursive: true });
	const tempPath = `${configPath}.${process.pid}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, "utf8");
	await rename(tempPath, configPath);
}

export function commitLanguageInstruction(language: CommitLanguage): string {
	return language === "chinese"
		? "Write the commit description and body in Simplified Chinese. Keep the Conventional Commit type and optional scope in English."
		: "Write the entire commit message in English.";
}
