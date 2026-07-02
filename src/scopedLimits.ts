import type { ScopedWeeklySnapshot, UsageResponse } from "./types.js";

/**
 * Extracts model-specific weekly limits from the API response into the stable
 * shape shared by tooltip rendering and history persistence. Malformed limits
 * are ignored so an unexpected API entry cannot break the usage display.
 */
export function getScopedWeeklyLimits(usage: UsageResponse): ScopedWeeklySnapshot[] {
  return (usage.limits ?? []).flatMap((limit) => {
    const displayName = limit.scope?.model?.display_name?.trim();
    if (
      limit.kind !== "weekly_scoped" ||
      !displayName ||
      typeof limit.percent !== "number" ||
      !Number.isFinite(limit.percent) ||
      limit.percent < 0 ||
      limit.percent > 100
    ) {
      return [];
    }

    return [
      {
        // Limited-access models may not expose an ID yet, so history falls back to the display name for identity.
        model_id: limit.scope?.model?.id?.trim() || null,
        display_name: displayName,
        percent: limit.percent,
        resets_at: limit.resets_at ?? null,
      },
    ];
  });
}
