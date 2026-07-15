import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ProgressState } from "./progress.js";

export const RESULT_ENTRY_TYPE = "pi-git-shortcuts-result";

export interface GitShortcutResult {
	operation: ProgressState["operation"];
	status: "success" | "error";
	label: string;
	detail?: string;
	durationMs: number;
	timestamp: number;
}

function formatDuration(durationMs: number): string {
	const seconds = Math.max(0, Math.round(durationMs / 1000));
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function registerResultRenderer(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<GitShortcutResult>(RESULT_ENTRY_TYPE, (entry, { expanded }, theme) => {
		const result = entry.data;
		if (!result) return new Text(theme.fg("dim", "pi-git-shortcuts: no result"), 0, 0);

		const succeeded = result.status === "success";
		const icon = theme.fg(succeeded ? "success" : "error", succeeded ? "✓" : "✗");
		const operation = theme.fg("muted", `[${result.operation}]`);
		const label = theme.fg(succeeded ? "text" : "error", result.label);
		const detail = result.detail ? theme.fg("dim", ` · ${result.detail}`) : "";
		let content = `${icon} ${operation} ${label}${detail}`;

		if (expanded) {
			const time = new Date(result.timestamp).toLocaleString();
			content += `\n${theme.fg("dim", `${formatDuration(result.durationMs)} · ${time}`)}`;
		}

		return new Text(content, 0, 0);
	});
}

export function appendResult(pi: ExtensionAPI, result: GitShortcutResult): void {
	pi.appendEntry<GitShortcutResult>(RESULT_ENTRY_TYPE, result);
}
