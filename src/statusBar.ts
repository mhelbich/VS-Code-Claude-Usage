import type { ColorThresholds, UsageResponse } from "./types.js";
import { buildStatusText, buildTooltipMarkdown, formatReset } from "./render.js";
import { describeForecastMethod, getWeeklyForecast, type ForecastStatus, type UsageForecast } from "./forecast.js";

export type State =
  | { kind: "loading" }
  | { kind: "ok"; usage: UsageResponse; thresholds: ColorThresholds; forecast?: UsageForecast | null }
  | { kind: "no-token" }
  | { kind: "error"; message?: string };

export type Action =
  | { type: "refresh-started" }
  | { type: "fetch-success"; usage: UsageResponse; thresholds: ColorThresholds; forecast?: UsageForecast | null }
  | { type: "fetch-error"; message?: string }
  | { type: "no-token" }
  | { type: "thresholds-changed"; thresholds: ColorThresholds };

export interface BarProps {
  text: string;
  tooltipText: string;
  tooltipIsMarkdown: boolean;
  color: string | undefined;
  backgroundColor: "warning" | "error" | undefined;
  visible?: boolean;
}

function forecastColor(status: ForecastStatus): string {
  switch (status) {
    case "safe":
      return "charts.green";
    case "watch":
      return "charts.yellow";
    case "risk":
      return "charts.red";
    case "unavailable":
      return "descriptionForeground";
  }
}

function forecastHeading(status: ForecastStatus): string {
  switch (status) {
    case "safe":
      return "On track";
    case "watch":
      return "Tight";
    case "risk":
      return "Limit risk";
    case "unavailable":
      return "Weekly forecast unavailable";
  }
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatForecastTooltip(forecast: NonNullable<ReturnType<typeof getWeeklyForecast>>, showUsed: boolean, now: number): string {
  const projectedValue = showUsed ? forecast.projectedUtilizationAtReset : forecast.projectedRemainingAtReset;
  const projectedLabel = showUsed ? "used" : "remaining";
  const projectedLine = `Projected at reset: **${clampPct(projectedValue).toFixed(1)}% ${projectedLabel}**`;
  const resetLine = `Reset: **${formatReset(new Date(forecast.reset).toISOString(), { now })}**`;
  const methodLine = `Based on: **${describeForecastMethod(forecast)}**`;

  if (forecast.projectedLimitHitAt !== null) {
    const hitLine = `Limit: **${formatReset(new Date(forecast.projectedLimitHitAt).toISOString(), { now })}**`;
    return `### Weekly Forecast\n\n🔴 **${forecastHeading(forecast.status)}**\n\n${hitLine}\n\n${projectedLine}\n\n${methodLine}\n\n${resetLine}`;
  }

  const statusLine = forecast.status === "watch" ? "Little buffer remains." : "Weekly usage looks on track.";

  return `### Weekly Forecast\n\n${forecast.status === "watch" ? "🟡" : "🟢"} **${forecastHeading(forecast.status)}**\n\n${projectedLine}\n\n${statusLine}\n\n${methodLine}\n\n${resetLine}`;
}

export function forecastStateToBarProps(state: State, showUsed = false, now = Date.now()): BarProps {
  if (state.kind !== "ok") {
    return {
      text: "$(circle-filled)",
      tooltipText: "Weekly forecast unavailable",
      tooltipIsMarkdown: false,
      color: forecastColor("unavailable"),
      backgroundColor: undefined,
      visible: false,
    };
  }

  const forecast = state.forecast === undefined ? getWeeklyForecast(state.usage, now) : state.forecast;
  if (!forecast) {
    return {
      text: "$(circle-filled)",
      tooltipText: "Weekly forecast unavailable",
      tooltipIsMarkdown: false,
      color: forecastColor("unavailable"),
      backgroundColor: undefined,
    };
  }

  return {
    text: "$(circle-filled)",
    tooltipText: formatForecastTooltip(forecast, showUsed, now),
    tooltipIsMarkdown: true,
    color: forecastColor(forecast.status),
    backgroundColor: undefined,
  };
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "refresh-started":
      return state.kind === "ok" ? state : { kind: "loading" };
    case "fetch-success":
      return action.forecast === undefined
        ? { kind: "ok", usage: action.usage, thresholds: action.thresholds }
        : { kind: "ok", usage: action.usage, thresholds: action.thresholds, forecast: action.forecast };
    case "fetch-error":
      return { kind: "error", message: action.message };
    case "no-token":
      return { kind: "no-token" };
    case "thresholds-changed":
      return state.kind === "ok" ? { ...state, thresholds: action.thresholds } : state;
  }
}

export function stateToBarProps(state: State, showUsed = false, showScopedWeeklyLimits = true): BarProps {
  switch (state.kind) {
    case "loading":
      return { text: "$(pulse) Claude …", tooltipText: "Claude Code usage — loading", tooltipIsMarkdown: false, color: undefined, backgroundColor: undefined };
    case "no-token":
      return {
        text: "$(pulse) Claude ✗",
        tooltipText: "Claude Code: not logged in — run `claude /login`",
        tooltipIsMarkdown: true,
        color: undefined,
        backgroundColor: "warning",
      };
    case "error":
      return {
        text: "$(pulse) Claude !",
        tooltipText: state.message ? `Claude Code\n\`${state.message}\`` : "Claude Code: API error",
        tooltipIsMarkdown: !!state.message,
        color: undefined,
        backgroundColor: "error",
      };
    case "ok":
      return {
        text: buildStatusText(state.usage, state.thresholds, showUsed),
        tooltipText: buildTooltipMarkdown(state.usage, state.thresholds, undefined, showUsed, showScopedWeeklyLimits, state.forecast),
        tooltipIsMarkdown: true,
        color: undefined,
        backgroundColor: undefined,
      };
  }
}
