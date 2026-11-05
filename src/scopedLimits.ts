import type { ScopedWeeklySnapshot, UsageLimit, UsageResponse } from "./types.js";

function toScopedSnapshot(limit: UsageLimit): ScopedWeeklySnapshot | null {
  const displayName = limit.scope?.model?.display_name?.trim();
  if (
    limit.kind !== "weekly_scoped" ||
    !displayName ||
    typeof limit.percent !== "number" ||
    !Number.isFinite(limit.percent) ||
    limit.percent < 0 ||
    limit.percent > 100
  ) {
    return null;
  }

  return {
    // Limited-access models may not expose an ID yet, so history falls back to the display name for identity.
    model_id: limit.scope?.model?.id?.trim() || null,
    display_name: displayName,
    percent: limit.percent,
    resets_at: limit.resets_at ?? null,
  };
}

/**
 * Extracts model-specific weekly limits from the API response into the stable
 * shape shared by tooltip rendering and history persistence. Malformed limits
 * are ignored so an unexpected API entry cannot break the usage display.
 */
export function getScopedWeeklyLimits(usage: UsageResponse): ScopedWeeklySnapshot[] {
  return (usage.limits ?? []).flatMap((limit) => {
    const snapshot = toScopedSnapshot(limit);
    return snapshot ? [snapshot] : [];
  });
}

/** Stable identity of a scoped limit; must match `scopedIdentity` in history-view/webview.js. */
export function scopedIdentity(scoped: Pick<ScopedWeeklySnapshot, "model_id" | "display_name">): string {
  return scoped.model_id ? `id:${scoped.model_id}` : `name:${scoped.display_name}`;
}

/**
 * Maps scoped-limit identity to the share of the overall weekly limit that model may use
 * (`allowance_percent_of_weekly`). Shares reference limits by array index, which shifts
 * when e.g. the session limit is absent, so the index is resolved against this response.
 */
export function getScopedShares(usage: UsageResponse): Map<string, number> {
  const limits = usage.limits ?? [];
  const shares = new Map<string, number>();
  for (const share of usage.weekly_scoped_shares ?? []) {
    const index = share.limit_index;
    const allowance = share.allowance_percent_of_weekly;
    if (typeof index !== "number" || typeof allowance !== "number" || !Number.isFinite(allowance)) continue;
    const limit = limits[index];
    const snapshot = limit ? toScopedSnapshot(limit) : null;
    if (snapshot) shares.set(scopedIdentity(snapshot), allowance);
  }
  return shares;
}

const KNOWN_LIMIT_KINDS = new Set(["session", "weekly_all", "weekly_scoped"]);

/** Top-level keys the extension reads, or knows to be irrelevant. Any other non-null key is reported. */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "five_hour",
  "seven_day",
  "limits",
  "extra_usage",
  "spend",
  "seven_day_breakdown",
  "weekly_scoped_shares",
  "member_dashboard_available",
]);

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * Describes parts of the API response the extension does not handle, so shape changes and
 * new plan features show up in the log instead of being silently dropped. Nothing here is
 * displayed because the meaning of these fields is unknown.
 */
export function describeUnhandledFields(usage: UsageResponse): string[] {
  const notes: string[] = [];

  for (const [key, value] of Object.entries(usage as Record<string, unknown>)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key) && isPresent(value)) {
      notes.push(`unhandled field ${key}: ${JSON.stringify(value)}`);
    }
  }

  for (const key of ["five_hour", "seven_day"] as const) {
    const lockedReason = usage[key]?.locked_reason;
    if (isPresent(lockedReason)) notes.push(`${key} locked_reason: ${JSON.stringify(lockedReason)}`);
  }

  if (isPresent(usage.spend?.severity) && usage.spend?.severity !== "normal") {
    notes.push(`spend severity: ${JSON.stringify(usage.spend?.severity)}`);
  }

  (usage.limits ?? []).forEach((limit, index) => {
    if (!KNOWN_LIMIT_KINDS.has(limit.kind ?? "")) {
      notes.push(`unhandled limit [${index}] kind ${JSON.stringify(limit.kind)}: ${JSON.stringify(limit)}`);
    } else if (limit.kind === "weekly_scoped" && !toScopedSnapshot(limit)) {
      notes.push(`dropped weekly_scoped limit [${index}]: ${JSON.stringify(limit)}`);
    }
    if (isPresent(limit.severity) && limit.severity !== "normal") {
      notes.push(`limit [${index}] ${limit.kind} severity: ${JSON.stringify(limit.severity)}`);
    }
  });

  return notes;
}
