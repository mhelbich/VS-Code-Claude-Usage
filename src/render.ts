import { ColorThresholds, UsageResponse } from "./types";

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

export function buildStatusText(usage: UsageResponse, t: ColorThresholds, showUsed = false): string {
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

export function buildTooltipMarkdown(usage: UsageResponse, t: ColorThresholds, options?: ResetFormatOptions, showUsed = false): string {
  const session = usage.five_hour;
  const week = usage.seven_day;
  const opus = usage.seven_day_opus;
  const extra = usage.extra_usage;

  let markdown = "### Claude Code Usage\n\n";

  if (session) {
    const rem = 100 - session.utilization;
    const displayValue = showUsed ? session.utilization : rem;
    const label = showUsed ? "used" : "remaining";
    markdown +=
      `**Session (5h)**\n\n` +
      `${makeHtmlBar(rem, session.utilization, t)} **${displayValue.toFixed(1)}%** ${label}\n\n` +
      `Resets in ${formatReset(session.resets_at, options)}\n\n`;
  }

  if (week) {
    const rem = 100 - week.utilization;
    const displayValue = showUsed ? week.utilization : rem;
    const label = showUsed ? "used" : "remaining";
    markdown +=
      `**Weekly (7d)**\n\n` +
      `${makeHtmlBar(rem, week.utilization, t)} **${displayValue.toFixed(1)}%** ${label}\n\n` +
      `Resets in ${formatReset(week.resets_at, options)}\n\n`;
  }

  if (opus && opus.utilization !== undefined) {
    const rem = 100 - opus.utilization;
    const displayValue = showUsed ? opus.utilization : rem;
    const label = showUsed ? "used" : "remaining";
    markdown += `**Opus (7d)**\n\n${makeHtmlBar(rem, opus.utilization, t)} **${displayValue.toFixed(1)}%** ${label}\n\n`;
  }

  if (extra && extra.is_enabled) {
    markdown += `**Extra usage:** ${extra.used_credits} / ${extra.monthly_limit} credits\n\n`;
  } else {
    markdown += `**Extra usage:** ✗ not enabled\n\n`;
  }

  markdown += "---\n*Click to refresh*";

  return markdown;
}
