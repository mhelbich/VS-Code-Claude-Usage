import type { UsageBucket, UsageResponse } from "./types.js";

export const FIVE_HOUR_MS = 5 * 3_600_000;
export const SEVEN_DAY_MS = 7 * 86_400_000;

export type ForecastWindow = "session" | "weekly";
export type ForecastStatus = "safe" | "watch" | "risk" | "unavailable";
export type ForecastConfidence = "high" | "low" | "none";
export type ForecastMethod = "linear" | "unavailable";

export interface UsageForecast {
  window: ForecastWindow;
  start: number;
  reset: number;
  currentUtilization: number;
  projectedUtilizationAtReset: number;
  projectedRemainingAtReset: number;
  projectedLimitHitAt: number | null;
  status: ForecastStatus;
  confidence: ForecastConfidence;
  method: ForecastMethod;
}

export interface ForecastOptions {
  now?: number;
  minElapsedRatio?: number;
  watchRemainingPct?: number;
}

export function parseIsoTime(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const parsed = Date.parse(isoDate);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyForecast(projectedUtilizationAtReset: number, confidence: ForecastConfidence, watchRemainingPct: number): ForecastStatus {
  if (confidence === "none") return "unavailable";
  if (projectedUtilizationAtReset > 100) return "risk";
  if (confidence === "low" || 100 - projectedUtilizationAtReset <= watchRemainingPct) return "watch";
  return "safe";
}

export function getLinearForecast(
  window: ForecastWindow,
  bucket: UsageBucket | null | undefined,
  durationMs: number,
  options: ForecastOptions = {},
): UsageForecast | null {
  const now = options.now ?? Date.now();
  const reset = parseIsoTime(bucket?.resets_at);
  if (!bucket || reset === null || now >= reset) return null;

  const start = reset - durationMs;
  const elapsedMs = now - start;
  if (elapsedMs <= 0) return null;

  const elapsedRatio = elapsedMs / durationMs;
  const minElapsedRatio = options.minElapsedRatio ?? 0;
  const confidence: ForecastConfidence = elapsedRatio >= minElapsedRatio ? "high" : "low";
  const currentUtilization = bucket.utilization;
  const projectedUtilizationAtReset = currentUtilization / elapsedRatio;
  const projectedRemainingAtReset = 100 - projectedUtilizationAtReset;
  const watchRemainingPct = options.watchRemainingPct ?? 10;

  let projectedLimitHitAt: number | null = null;
  if (currentUtilization > 0 && projectedUtilizationAtReset > 100) {
    const hitAt = start + (elapsedMs * 100) / currentUtilization;
    if (hitAt < reset) projectedLimitHitAt = hitAt;
  }

  return {
    window,
    start,
    reset,
    currentUtilization,
    projectedUtilizationAtReset,
    projectedRemainingAtReset,
    projectedLimitHitAt,
    status: classifyForecast(projectedUtilizationAtReset, confidence, watchRemainingPct),
    confidence,
    method: "linear",
  };
}

export function getSessionForecast(usage: UsageResponse, now = Date.now()): UsageForecast | null {
  return getLinearForecast("session", usage.five_hour, FIVE_HOUR_MS, {
    now,
    // Session forecasts are intentionally hidden early because 5h burn rate is noisy.
    minElapsedRatio: 0.2,
    watchRemainingPct: 10,
  });
}

export function getWeeklyForecast(usage: UsageResponse, now = Date.now()): UsageForecast | null {
  return getLinearForecast("weekly", usage.seven_day, SEVEN_DAY_MS, {
    now,
    minElapsedRatio: 0,
    watchRemainingPct: 10,
  });
}
