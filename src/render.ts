import { ColorThresholds, UsageResponse } from "./types";

const FIVE_HOUR_MS = 5 * 3_600_000;
const SEVEN_DAY_MS = 7 * 86_400_000;

type ResetFormatOptions = {
  now?: number;
  formatAbsolute?: (date: Date) => string;
};

export interface WeeklyForecast {
  weeklyStart: number;
  weeklyReset: number;
  currentUtilization: number;
  projectedUtilizationAtReset: number;
  projectedLimitHitAt: number | null;
}

export type WeeklyPaceStatus = "under" | "on" | "over";

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

function parseIsoTime(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const parsed = Date.parse(isoDate);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getSessionStart(isoDate: string | null | undefined): number | null {
  const resetAt = parseIsoTime(isoDate);
  return resetAt === null ? null : resetAt - FIVE_HOUR_MS;
}

export function getWeeklyForecast(usage: UsageResponse, now = Date.now()): WeeklyForecast | null {
  const week = usage.seven_day;
  const weeklyReset = parseIsoTime(week?.resets_at);
  if (!week || weeklyReset === null || now >= weeklyReset) return null;

  const weeklyStart = weeklyReset - SEVEN_DAY_MS;
  const elapsedMs = now - weeklyStart;
  if (elapsedMs <= 0) return null;

  // Project the final weekly usage by extending the current burn rate across the full 7-day window.
  const elapsedRatio = elapsedMs / SEVEN_DAY_MS;
  const currentUtilization = week.utilization;
  const projectedUtilizationAtReset = currentUtilization / elapsedRatio;

  let projectedLimitHitAt: number | null = null;
  if (currentUtilization > 0 && projectedUtilizationAtReset > 100) {
    // Solve for the timestamp where the linear projection reaches 100% used.
    const hitAt = weeklyStart + (elapsedMs * 100) / currentUtilization;
    if (hitAt < weeklyReset) projectedLimitHitAt = hitAt;
  }

  return {
    weeklyStart,
    weeklyReset,
    currentUtilization,
    projectedUtilizationAtReset,
    projectedLimitHitAt,
  };
}

export function getWeeklyPaceStatus(forecast: WeeklyForecast): WeeklyPaceStatus {
  if (forecast.projectedUtilizationAtReset <= 95) return "under";
  if (forecast.projectedUtilizationAtReset <= 100) return "on";
  return "over";
}

export function getWeeklyPaceIcon(forecast: WeeklyForecast): string {
  switch (getWeeklyPaceStatus(forecast)) {
    case "under":
      return "$(arrow-down)";
    case "on":
      return "$(arrow-right)";
    case "over":
      return "$(arrow-up)";
  }
}

function formatWeeklyForecastSummary(forecast: WeeklyForecast, showUsed: boolean, options?: ResetFormatOptions): string {
  if (forecast.projectedLimitHitAt !== null) {
    const projectedHit = formatReset(new Date(forecast.projectedLimitHitAt).toISOString(), options);
    return showUsed
      ? `Forecast: At current pace, weekly limit projects to hit in ${projectedHit} before reset.`
      : `Forecast: At current pace, weekly remaining projects to reach 0 in ${projectedHit} before reset.`;
  }

  // The same projection is phrased differently depending on whether the UI is showing used or remaining.
  const projectedRemaining = 100 - forecast.projectedUtilizationAtReset;
  return showUsed
    ? `Forecast: Projected weekly usage at reset: ${forecast.projectedUtilizationAtReset.toFixed(1)}%.`
    : `Forecast: Projected weekly remaining at reset: ${projectedRemaining.toFixed(1)}%.`;
}

export function buildStatusText(usage: UsageResponse, t: ColorThresholds, showUsed = false, now = Date.now()): string {
  const session = usage.five_hour;
  const week = usage.seven_day;
  const weeklyForecast = getWeeklyForecast(usage, now);

  const parts: string[] = [];
  if (session) {
    const value = showUsed ? session.utilization : 100 - session.utilization;
    parts.push(`${utilColor(session.utilization, t)} S: ${value.toFixed(0)}%`);
  }
  if (week) {
    const value = showUsed ? week.utilization : 100 - week.utilization;
    const paceIcon = weeklyForecast ? ` ${getWeeklyPaceIcon(weeklyForecast)}` : "";
    parts.push(`${utilColor(week.utilization, t)} W: ${value.toFixed(0)}%${paceIcon}`);
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
  forecastSummary?: string,
): string {
  const displayValue = showUsed ? bucket.utilization : 100 - bucket.utilization;
  const label = showUsed ? "used" : "remaining";
  const resetLine = bucket.resets_at !== undefined ? `Resets in ${formatReset(bucket.resets_at, resetOptions)}\n\n` : "";
  const forecastLine = forecastSummary ? `${forecastSummary}\n\n` : "";
  return `**${heading}**\n\n` + `${makeHtmlBar(displayValue, bucket.utilization, t)} **${displayValue.toFixed(1)}%** ${label}\n\n` + resetLine + forecastLine;
}

export function buildTooltipMarkdown(usage: UsageResponse, t: ColorThresholds, options?: ResetFormatOptions, showUsed = false): string {
  const { five_hour: session, seven_day: week, seven_day_opus: opus, extra_usage: extra } = usage;
  const weeklyForecast = getWeeklyForecast(usage, options?.now);

  let markdown = "### Claude Code Usage\n\n";

  if (session) markdown += formatUsageBucket("Session (5h)", session, t, showUsed, options);
  if (week) markdown += formatUsageBucket("Weekly (7d)", week, t, showUsed, options, weeklyForecast ? formatWeeklyForecastSummary(weeklyForecast, showUsed, options) : undefined);
  if (opus && opus.utilization !== undefined) markdown += formatUsageBucket("Opus (7d)", opus, t, showUsed);

  markdown += extra?.is_enabled
    ? `**Extra usage:** ${extra.used_credits} / ${extra.monthly_limit} credits\n\n`
    : `**Extra usage:** ✗ not enabled\n\n`;

  markdown += "---\n*Click to refresh*";

  return markdown;
}
