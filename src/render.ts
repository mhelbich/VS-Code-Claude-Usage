import type { ColorThresholds, UsageResponse } from "./types.js";
import { FIVE_HOUR_MS, getSessionForecast, getWeeklyForecast, parseIsoTime, type ForecastStatus, type UsageForecast } from "./forecast.js";
import { getScopedWeeklyLimits } from "./scopedLimits.js";

type ResetFormatOptions = {
  now?: number;
  formatAbsolute?: (date: Date) => string;
};

const defaultAbsoluteFormatter = (date: Date): string =>
  date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function utilColor(utilization: number, t: ColorThresholds): string {
  if (utilization >= t.danger) return "🔴";
  if (utilization >= t.warning) return "🟡";
  return "🟢";
}

export function makeHtmlBar(remaining: number, utilization: number, t: ColorThresholds, width = 20): string {
  const filledCount = Math.round((remaining / 100) * width);
  const usedCount = width - filledCount;

  let color: string;
  if (utilization >= t.danger) color = "#f44747";
  else if (utilization >= t.warning) color = "#cca700";
  else color = "#4EC9B0";

  const filled = filledCount > 0 ? `<span style="color:${color};">${"█".repeat(filledCount)}</span>` : "";
  const used = usedCount > 0 ? `<span style="color:#555555;">${"█".repeat(usedCount)}</span>` : "";
  return filled + used;
}

export function formatReset(isoDate: string | null | undefined, options: ResetFormatOptions = {}): string {
  if (!isoDate) return "—";

  const d = new Date(isoDate);
  const now = options.now ?? Date.now();
  const diff = d.getTime() - now;

  if (diff <= 0) return "resetting…";

  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const relative = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const absolute = (options.formatAbsolute ?? defaultAbsoluteFormatter)(d);

  return `${relative} (${absolute})`;
}

export function getSessionStart(isoDate: string | null | undefined): number | null {
  const resetAt = parseIsoTime(isoDate);
  return resetAt === null ? null : resetAt - FIVE_HOUR_MS;
}

export { getSessionForecast, getWeeklyForecast };

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function usageBarColor(utilization: number, t: ColorThresholds): string {
  if (utilization >= t.danger) return "#f44747";
  if (utilization >= t.warning) return "#cca700";
  return "#4EC9B0";
}

function forecastMarkerColor(status: ForecastStatus): string {
  switch (status) {
    case "risk":
      return "#f44747";
    case "watch":
      return "#cca700";
    case "safe":
      return "#4EC9B0";
    case "unavailable":
      return "#858585";
  }
}

export function makeUsageBar(utilization: number, t: ColorThresholds, width = 20, markerUtilization?: number, markerStatus: ForecastStatus = "unavailable"): string {
  const usedSlots = Math.round((clampPct(utilization) / 100) * width);
  const markerIndex =
    markerUtilization === undefined ? null : Math.round((clampPct(markerUtilization) / 100) * (width - 1));
  const chars: string[] = [];

  for (let i = 0; i < width; i += 1) {
    if (markerIndex === i) {
      chars.push(`<span style="color:${forecastMarkerColor(markerStatus)};">│</span>`);
      continue;
    }
    const char = i < usedSlots ? "█" : "░";
    const color = i < usedSlots ? usageBarColor(utilization, t) : "#555555";
    chars.push(`<span style="color:${color};">${char}</span>`);
  }

  return chars.join("");
}

function formatForecastSummary(forecast: UsageForecast, showUsed: boolean, options?: ResetFormatOptions): string {
  const method = forecast.method === "personalized"
    ? `Personalized (${forecast.historyWeeks} week${forecast.historyWeeks === 1 ? "" : "s"})`
    : forecast.method === "baseline" ? "Baseline" : "Linear";
  if (forecast.projectedLimitHitAt !== null) {
    const projectedHit = formatReset(new Date(forecast.projectedLimitHitAt).toISOString(), options);
    return `Forecast: Limit in ${projectedHit} · ${method}`;
  }

  return showUsed
    ? `Forecast: ${clampPct(forecast.projectedUtilizationAtReset).toFixed(1)}% used at reset · ${method}`
    : `Forecast: ${clampPct(forecast.projectedRemainingAtReset).toFixed(1)}% remaining at reset · ${method}`;
}

export function buildStatusText(usage: UsageResponse, t: ColorThresholds, showUsed = false, now = Date.now()): string {
  const session = usage.five_hour;
  const week = usage.seven_day;

  const parts: string[] = [];
  if (session) {
    const value = showUsed ? session.utilization : 100 - session.utilization;
    parts.push(`${utilColor(session.utilization, t)} S: ${value.toFixed(0)}%`);
  }
  if (week) {
    const value = showUsed ? week.utilization : 100 - week.utilization;
    parts.push(`${utilColor(week.utilization, t)} W: ${value.toFixed(0)}%`);
  }

  return parts.length ? `$(pulse) ${parts.join(" │ ")}` : "$(pulse) Claude —";
}

type UsageBucket = { utilization: number; resets_at?: string | null };
function formatUsageBucket(
  heading: string,
  bucket: UsageBucket,
  t: ColorThresholds,
  showUsed: boolean,
  resetOptions?: ResetFormatOptions,
  forecast?: UsageForecast,
): string {
  const displayValue = showUsed ? bucket.utilization : 100 - bucket.utilization;
  const label = showUsed ? "used" : "remaining";
  const resetLine = bucket.resets_at !== undefined ? `Resets in ${formatReset(bucket.resets_at, resetOptions)}\n\n` : "";
  const bar = makeUsageBar(bucket.utilization, t, 20, forecast?.projectedUtilizationAtReset, forecast?.status);
  const forecastLine = forecast ? `${formatForecastSummary(forecast, showUsed, resetOptions)}\n\n` : "";
  return `**${heading}**\n\n` + `${bar} **${displayValue.toFixed(1)}%** ${label}\n\n` + resetLine + forecastLine;
}

export function buildTooltipMarkdown(
  usage: UsageResponse,
  t: ColorThresholds,
  options?: ResetFormatOptions,
  showUsed = false,
  showScopedWeeklyLimits = true,
  providedWeeklyForecast?: UsageForecast | null,
): string {
  const { five_hour: session, seven_day: week, extra_usage: extra } = usage;
  const weeklyForecast = providedWeeklyForecast === undefined ? getWeeklyForecast(usage, options?.now) : providedWeeklyForecast;
  const sessionForecast = getSessionForecast(usage, options?.now);

  let markdown = "### Claude Code Usage\n\n";

  if (session) markdown += formatUsageBucket("Session (5h)", session, t, showUsed, options, sessionForecast?.confidence === "high" ? sessionForecast : undefined);
  if (week) markdown += formatUsageBucket("Weekly (7d)", week, t, showUsed, options, weeklyForecast ?? undefined);
  if (showScopedWeeklyLimits) {
    for (const scoped of getScopedWeeklyLimits(usage)) {
      markdown += formatUsageBucket(`${scoped.display_name} (7d)`, { utilization: scoped.percent, resets_at: scoped.resets_at }, t, showUsed, options);
    }
  }

  markdown += extra?.is_enabled
    ? `**Extra usage:** ${extra.used_credits} / ${extra.monthly_limit} credits\n\n`
    : `**Extra usage:** ✗ not enabled\n\n`;

  markdown += "---\n*Click to refresh*";

  return markdown;
}
