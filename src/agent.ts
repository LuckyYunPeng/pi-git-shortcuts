import type {
	ExtensionContext,
	ExtensionRuntime,
	ModelRegistry,
	ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	createExtensionRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

let runtime: ExtensionRuntime | undefined;

function getRuntime(): ExtensionRuntime {
	runtime ??= createExtensionRuntime();
	return runtime;
}

function createResourceLoader(systemPrompt: string): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: getRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

function resolveModel(
	ctx: ExtensionContext,
	configuredModel?: string,
): NonNullable<ReturnType<ModelRegistry["find"]>> {
	if (!configuredModel) {
		if (!ctx.model) throw new Error("No active model is available");
		return ctx.model;
	}

	const separator = configuredModel.indexOf("/");
	if (separator < 1 || separator === configuredModel.length - 1) {
		throw new Error(`Invalid configured model: ${configuredModel}`);
	}
	const model = ctx.modelRegistry.find(
		configuredModel.slice(0, separator),
		configuredModel.slice(separator + 1),
	);
	if (!model) throw new Error(`Configured model is not available: ${configuredModel}`);
	return model;
}

async function runIsolatedAgent(
	ctx: ExtensionContext,
	cwd: string,
	systemPrompt: string,
	prompt: string,
	tools: string[],
	configuredModel?: string,
): Promise<string> {
	const { session } = await createAgentSession({
		cwd,
		model: resolveModel(ctx, configuredModel),
		thinkingLevel: "low",
		modelRegistry: ctx.modelRegistry,
		resourceLoader: createResourceLoader(systemPrompt),
		sessionManager: SessionManager.inMemory(cwd),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
		tools,
	});
	const output: string[] = [];
	const unsubscribe = session.subscribe((event) => {
		if (event.type !== "message_end" || event.message.role !== "assistant") return;
		for (const part of event.message.content) {
			if (part.type === "text" && part.text.trim()) output.push(part.text);
		}
	});

	try {
		await session.prompt(prompt);
	} finally {
		unsubscribe();
	}

	return output.join("\n\n").trim();
}

export async function generateCommitMessage(
	ctx: ExtensionContext,
	cwd: string,
	diffStat: string,
	diff: string,
	instructions: string,
	languageInstruction: string,
	model?: string,
): Promise<string> {
	const instructionBlock = instructions.trim()
		? `\nUser requirements:\n${instructions.trim()}\n`
		: "";
	const prompt = [
		"Generate one Conventional Commit message for the staged changes below.",
		instructionBlock,
		"Requirements:",
		`- ${languageInstruction}`,
		"- Format the first line as type(scope): description or type: description.",
		"- Use an imperative description and keep the first line at most 72 characters.",
		"- Analyze the changes across every file before writing the message.",
		"- When there are multiple substantive changes, add a body with one concise bullet per major change.",
		"- Output only the commit message, without Markdown fences or commentary.",
		"",
		"Diff stat:",
		diffStat,
		"",
		"Staged diff:",
		diff.slice(0, 50_000),
		diff.length > 50_000 ? "\n[diff truncated]" : "",
	].join("\n");

	return runIsolatedAgent(
		ctx,
		cwd,
		"You write precise Conventional Commit messages from staged Git diffs.",
		prompt,
		[],
		model,
	);
}

export async function resolveRebaseConflicts(
	ctx: ExtensionContext,
	cwd: string,
	conflictedFiles: string[],
	model?: string,
): Promise<string> {
	const tools = ["read", "edit", "grep", "find", "ls"];
	const prompt = [
		"Resolve the current Git rebase conflicts in the working tree.",
		"",
		`Conflicted files:\n${conflictedFiles.map((file) => `- ${file}`).join("\n")}`,
		"",
		"Rules:",
		"- Inspect both sides of every conflict and preserve the intended behavior from each side.",
		"- Edit only files required to resolve the listed conflicts.",
		"- Remove every conflict marker: <<<<<<<, =======, and >>>>>>>.",
		"- Do not run Git commands; the extension controls rebase state.",
		"- Do not create commits.",
		"- Finish with a concise summary of the resolutions.",
	].join("\n");

	return runIsolatedAgent(
		ctx,
		cwd,
		"You resolve Git rebase conflicts carefully using only repository file tools.",
		prompt,
		tools,
		model,
	);
}
