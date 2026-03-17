import type { ColorThresholds, UsageResponse } from "./types.js";
import { buildStatusText, buildTooltipMarkdown } from "./render.js";

export type State =
  | { kind: "loading" }
  | { kind: "ok"; usage: UsageResponse; thresholds: ColorThresholds }
  | { kind: "no-token" }
  | { kind: "error"; message?: string };

export type Action =
  | { type: "refresh-started" }
  | { type: "fetch-success"; usage: UsageResponse; thresholds: ColorThresholds }
  | { type: "fetch-error"; message?: string }
  | { type: "no-token" }
  | { type: "thresholds-changed"; thresholds: ColorThresholds };

export interface BarProps {
  text: string;
  tooltipText: string;
  tooltipIsMarkdown: boolean;
  backgroundColor: "warning" | "error" | undefined;
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "refresh-started":
      return { kind: "loading" };
    case "fetch-success":
      return { kind: "ok", usage: action.usage, thresholds: action.thresholds };
    case "fetch-error":
      return { kind: "error", message: action.message };
    case "no-token":
      return { kind: "no-token" };
    case "thresholds-changed":
      return state.kind === "ok" ? { ...state, thresholds: action.thresholds } : state;
  }
}

export function stateToBarProps(state: State): BarProps {
  switch (state.kind) {
    case "loading":
      return { text: "$(pulse) Claude …", tooltipText: "Claude Code usage — loading", tooltipIsMarkdown: false, backgroundColor: undefined };
    case "no-token":
      return {
        text: "$(pulse) Claude ✗",
        tooltipText: "Claude Code: not logged in — run `claude /login`",
        tooltipIsMarkdown: true,
        backgroundColor: "warning",
      };
    case "error":
      return {
        text: "$(pulse) Claude !",
        tooltipText: state.message ? `Claude Code\n\`${state.message}\`` : "Claude Code: API error",
        tooltipIsMarkdown: !!state.message,
        backgroundColor: "error",
      };
    case "ok":
      return {
        text: buildStatusText(state.usage, state.thresholds),
        tooltipText: buildTooltipMarkdown(state.usage, state.thresholds),
        tooltipIsMarkdown: true,
        backgroundColor: undefined,
      };
  }
}
