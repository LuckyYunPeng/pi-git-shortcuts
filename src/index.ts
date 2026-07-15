import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { commitAndPush, commitChanges } from "./commands.js";

export default function gitShortcuts(pi: ExtensionAPI) {
	pi.registerCommand("commit", {
		description: "Generate a commit message in an isolated agent and commit all changes",
		handler: async (args, ctx) => {
			await commitChanges(pi, ctx, args);
		},
	});

	pi.registerCommand("cp", {
		description: "Commit all changes and push the current branch",
		handler: async (args, ctx) => {
			await commitAndPush(pi, ctx, args);
		},
	});
}
