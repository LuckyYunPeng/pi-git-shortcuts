import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { commitAndPush, commitChanges, pullChanges, pushChanges } from "./commands.js";
import { type CommitLanguage, getConfigPath, readConfig, writeConfig } from "./config.js";
import { registerResultRenderer } from "./result.js";

const LANGUAGE_OPTIONS = ["English", "简体中文"] as const;
const ACTIVE_MODEL = "Use active model";

export default async function gitShortcuts(pi: ExtensionAPI) {
	let config = await readConfig();
	registerResultRenderer(pi);

	pi.registerCommand("commit", {
		description: "Generate a commit message in an isolated agent and commit all changes",
		handler: async (args, ctx) => {
			await commitChanges(pi, ctx, args, config.commitLanguage, undefined, true, config.model);
		},
	});

	pi.registerCommand("cp", {
		description: "Commit all changes and push the current branch",
		handler: async (args, ctx) => {
			await commitAndPush(pi, ctx, args, config.commitLanguage, config.model);
		},
	});

	pi.registerCommand("pull", {
		description: "Pull and rebase the current branch, resolving conflicts in an isolated agent",
		handler: async (_args, ctx) => {
			await pullChanges(pi, ctx, config.model);
		},
	});

	pi.registerCommand("push", {
		description: "Push the current branch without creating a commit",
		handler: async (_args, ctx) => {
			await pushChanges(pi, ctx, config.model);
		},
	});

	pi.registerCommand("git-shortcuts-config", {
		description: "Configure the model and commit message language used by Git shortcuts",
		handler: async (_args, ctx) => {
			const setting = await ctx.ui.select("Configure pi-git-shortcuts", [
				`Model (${config.model ?? ACTIVE_MODEL})`,
				`Commit language (${config.commitLanguage === "chinese" ? "简体中文" : "English"})`,
			]);
			if (!setting) return;

			let selected: string | undefined;
			if (setting.startsWith("Model")) {
				selected = await ctx.ui.select("Model for Git shortcuts", [
					ACTIVE_MODEL,
					...ctx.modelRegistry
						.getAvailable()
						.map((model) => `${model.provider}/${model.id}`)
						.sort(),
				]);
				if (!selected) return;
				config = { ...config, model: selected === ACTIVE_MODEL ? undefined : selected };
			} else {
				selected = await ctx.ui.select("Commit message language", [...LANGUAGE_OPTIONS]);
				if (!selected) return;
				const commitLanguage: CommitLanguage = selected === "简体中文" ? "chinese" : "english";
				config = { ...config, commitLanguage };
			}

			await writeConfig(config);
			ctx.ui.notify(`pi-git-shortcuts: setting updated to ${selected}\n${getConfigPath()}`, "info");
		},
	});
}
