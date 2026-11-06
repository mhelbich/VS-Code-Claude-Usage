import type { ColorThresholds, UsageBucket, UsageResponse } from "./types.js";
import { buildStatusText, buildTooltipMarkdown, formatAsOf, formatReset, statusLead, type AccountDisplay } from "./render.js";
import { describeForecastMethod, getWeeklyForecast, parseIsoTime, type ForecastStatus, type UsageForecast } from "./forecast.js";

export type State =
  | { kind: "loading" }
  | { kind: "ok"; usage: UsageResponse; thresholds: ColorThresholds; forecast?: UsageForecast | null }
  | { kind: "no-token" }
  /** No valid token, but the config dir's cache still has usage from before the weekly reset. */
  | { kind: "stale"; usage: UsageResponse; fetchedAt: number; thresholds: ColorThresholds }
  | { kind: "error"; message?: string };

export type Action =
  | { type: "refresh-started" }
  | { type: "fetch-success"; usage: UsageResponse; thresholds: ColorThresholds; forecast?: UsageForecast | null }
  | { type: "fetch-error"; message?: string }
  | { type: "no-token" }
  | { type: "last-known"; usage: UsageResponse; fetchedAt: number; thresholds: ColorThresholds }
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
      return state.kind === "ok" || state.kind === "stale" ? state : { kind: "loading" };
    case "fetch-success":
      return action.forecast === undefined
        ? { kind: "ok", usage: action.usage, thresholds: action.thresholds }
        : { kind: "ok", usage: action.usage, thresholds: action.thresholds, forecast: action.forecast };
    case "fetch-error":
      return { kind: "error", message: action.message };
    case "no-token":
      return { kind: "no-token" };
    case "last-known":
      return { kind: "stale", usage: action.usage, fetchedAt: action.fetchedAt, thresholds: action.thresholds };
    case "thresholds-changed":
      return state.kind === "ok" || state.kind === "stale" ? { ...state, thresholds: action.thresholds } : state;
  }
}

/**
 * Usage as it stands now for limits whose reset has passed since it was fetched: their utilization is 0
 * and the next reset is unknown. Used for last-known (cached) usage of an account without a valid token.
 */
export function withElapsedResets(usage: UsageResponse, now: number): UsageResponse {
  const isElapsed = (resetsAt: string | null | undefined) => {
    const reset = parseIsoTime(resetsAt);
    return reset !== null && reset <= now;
  };
  const resetBucket = (bucket: UsageBucket): UsageBucket => (isElapsed(bucket.resets_at) ? { ...bucket, utilization: 0, resets_at: null } : bucket);

  const result: UsageResponse = { ...usage };
  if (usage.five_hour) result.five_hour = resetBucket(usage.five_hour);
  if (usage.seven_day) result.seven_day = resetBucket(usage.seven_day);
  if (usage.limits) {
    result.limits = usage.limits.map((limit) => (isElapsed(limit.resets_at) ? { ...limit, percent: 0, resets_at: null } : limit));
  }
  return result;
}

export function stateToBarProps(state: State, showUsed = false, showScopedWeeklyLimits = true, display: AccountDisplay = {}, now = Date.now()): BarProps {
  const who = display.label ? `Claude Code (${display.label})` : "Claude Code";
  switch (state.kind) {
    case "loading":
      return { text: `${statusLead(display)} …`, tooltipText: `${who} usage — loading`, tooltipIsMarkdown: false, color: undefined, backgroundColor: undefined };
    case "no-token":
      return {
        text: `${statusLead(display)} ✗`,
        tooltipText: `${who}: not logged in — run \`claude /login\``,
        tooltipIsMarkdown: true,
        color: undefined,
        backgroundColor: "warning",
      };
    case "error":
      return {
        text: `${statusLead(display)} !`,
        tooltipText: state.message ? `${who}\n\`${state.message}\`` : `${who}: API error`,
        tooltipIsMarkdown: !!state.message,
        color: undefined,
        backgroundColor: "error",
      };
    case "stale": {
      const usage = withElapsedResets(state.usage, now);
      const note =
        `*Last known usage, as of ${formatAsOf(state.fetchedAt)}. No valid token — use Claude with this account ` +
        "or run `claude /login` to update.*\n\n";
      return {
        text: buildStatusText(usage, state.thresholds, showUsed, now, display),
        tooltipText:
          note + buildTooltipMarkdown(usage, state.thresholds, { now }, showUsed, showScopedWeeklyLimits, null, { accountLabel: display.label, forecasts: false }),
        tooltipIsMarkdown: true,
        color: "disabledForeground",
        backgroundColor: undefined,
      };
    }
    case "ok":
      return {
        text: buildStatusText(state.usage, state.thresholds, showUsed, undefined, display),
        tooltipText: buildTooltipMarkdown(state.usage, state.thresholds, undefined, showUsed, showScopedWeeklyLimits, state.forecast, { accountLabel: display.label }),
        tooltipIsMarkdown: true,
        color: undefined,
        backgroundColor: undefined,
      };
  }
}
