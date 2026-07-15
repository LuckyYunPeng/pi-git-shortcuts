import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "pi-git-shortcuts-progress";

export type StepState = "active" | "done" | "warning" | "error";

export interface ProgressStep {
	label: string;
	detail?: string;
	state: StepState;
}

export interface ProgressState {
	operation: "commit" | "commit + push";
	startedAt: number;
	status: "running" | "done" | "error";
	steps: ProgressStep[];
}

function elapsed(startedAt: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function fit(value: string, width: number): string {
	return visibleWidth(value) <= width ? value : truncateToWidth(value, width, "…");
}

export function renderProgressLines(state: ProgressState, theme: Theme, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const statusIcon =
		state.status === "done"
			? theme.fg("success", "✓")
			: state.status === "error"
				? theme.fg("error", "✗")
				: theme.fg("accent", "◆");
	const headingLeft = `${statusIcon} ${theme.fg("accent", theme.bold("pi-git-shortcuts"))} ${theme.fg("muted", state.operation)}`;
	const duration = theme.fg("dim", elapsed(state.startedAt));
	const gap = Math.max(1, safeWidth - visibleWidth(headingLeft) - visibleWidth(duration));
	const lines = [fit(`${headingLeft}${" ".repeat(gap)}${duration}`, safeWidth)];

	for (const [index, step] of state.steps.entries()) {
		const isLast = index === state.steps.length - 1;
		const branch = theme.fg("dim", isLast ? "└─" : "├─");
		const icon =
			step.state === "done"
				? theme.fg("success", "✓")
				: step.state === "warning"
					? theme.fg("warning", "!")
					: step.state === "error"
						? theme.fg("error", "✗")
						: theme.fg("accent", "○");
		const labelColor: ThemeColor =
			step.state === "error" ? "error" : step.state === "warning" ? "warning" : "text";
		const detail = step.detail ? theme.fg("dim", ` · ${step.detail}`) : "";
		lines.push(fit(`${branch} ${icon} ${theme.fg(labelColor, step.label)}${detail}`, safeWidth));
	}

	return lines;
}

class ProgressComponent implements Component {
	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly getState: () => ProgressState,
	) {}

	render(width: number): string[] {
		return renderProgressLines(this.getState(), this.theme, width);
	}

	invalidate(): void {}

	update(): void {
		this.tui.requestRender();
	}
}

export class GitShortcutProgress {
	private state: ProgressState;
	private component?: ProgressComponent;
	private timer?: ReturnType<typeof setInterval>;
	private hideTimer?: ReturnType<typeof setTimeout>;

	constructor(
		private readonly ctx: ExtensionContext,
		operation: ProgressState["operation"],
	) {
		this.state = { operation, startedAt: Date.now(), status: "running", steps: [] };
		if (!ctx.hasUI) return;

		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui, theme) => {
				this.component = new ProgressComponent(tui, theme, () => this.state);
				return this.component;
			},
			{ placement: "aboveEditor" },
		);
		this.timer = setInterval(() => this.component?.update(), 1000);
		this.timer.unref?.();
	}

	step(label: string, detail?: string): void {
		this.finishActive("done");
		this.state.steps.push({ label, detail, state: "active" });
		this.component?.update();
	}

	warning(label: string, detail?: string): void {
		this.finishActive("done");
		this.state.steps.push({ label, detail, state: "warning" });
		this.component?.update();
	}

	succeed(label: string, detail?: string): void {
		this.finishActive("done");
		this.state.steps.push({ label, detail, state: "done" });
		this.state.status = "done";
		this.finish(6000);
		if (!this.ctx.hasUI)
			this.ctx.ui.notify(`pi-git-shortcuts: ${label}${detail ? `\n${detail}` : ""}`, "info");
	}

	fail(label: string, detail?: string): void {
		this.finishActive("error");
		this.state.steps.push({ label, detail, state: "error" });
		this.state.status = "error";
		this.finish(12_000);
		this.ctx.ui.notify(`pi-git-shortcuts: ${label}${detail ? `\n${detail}` : ""}`, "error");
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		if (this.hideTimer) clearTimeout(this.hideTimer);
		this.ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	private finishActive(state: StepState): void {
		for (let index = this.state.steps.length - 1; index >= 0; index--) {
			const step = this.state.steps[index];
			if (step?.state === "active") {
				step.state = state;
				return;
			}
		}
	}

	private finish(hideAfterMs: number): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.component?.update();
		if (!this.ctx.hasUI) return;
		this.hideTimer = setTimeout(() => this.dispose(), hideAfterMs);
		this.hideTimer.unref?.();
	}
}
