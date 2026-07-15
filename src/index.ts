import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { commitAndPush, commitChanges } from "./commands.js";
import { type CommitLanguage, getConfigPath, readConfig, writeConfig } from "./config.js";

const LANGUAGE_OPTIONS = ["English", "简体中文"] as const;

export default async function gitShortcuts(pi: ExtensionAPI) {
	let config = await readConfig();

	pi.registerCommand("commit", {
		description: "Generate a commit message in an isolated agent and commit all changes",
		handler: async (args, ctx) => {
			await commitChanges(pi, ctx, args, config.commitLanguage);
		},
	});

	pi.registerCommand("cp", {
		description: "Commit all changes and push the current branch",
		handler: async (args, ctx) => {
			await commitAndPush(pi, ctx, args, config.commitLanguage);
		},
	});

	pi.registerCommand("git-shortcuts-config", {
		description: "Configure the language used for generated commit messages",
		handler: async (_args, ctx) => {
			const currentLabel = config.commitLanguage === "chinese" ? "简体中文" : "English";
			const selected = await ctx.ui.select(`Commit message language (current: ${currentLabel})`, [
				...LANGUAGE_OPTIONS,
			]);
			if (!selected) return;

			const commitLanguage: CommitLanguage = selected === "简体中文" ? "chinese" : "english";
			config = { ...config, commitLanguage };
			await writeConfig(config);
			ctx.ui.notify(
				`pi-git-shortcuts: commit message language set to ${selected}\n${getConfigPath()}`,
				"info",
			);
		},
	});
}
