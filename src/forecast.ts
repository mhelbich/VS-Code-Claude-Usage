import type { HistoryEntry, UsageBucket, UsageResponse } from "./types.js";

export const FIVE_HOUR_MS = 5 * 3_600_000;
export const SEVEN_DAY_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;
const PROFILE_BIN_MS = 4 * 3_600_000;
const PROFILE_BIN_COUNT = SEVEN_DAY_MS / PROFILE_BIN_MS;
const PROFILE_COVERAGE_TOLERANCE_MS = 8 * 3_600_000;
const MAX_INTERPOLATION_GAP_MS = 8 * 3_600_000;
const BASELINE_PRIOR_MS = 2 * DAY_MS;
const FULL_HISTORY_WEIGHT = 1.5;
const MAX_PROFILE_WEEKS = 8;
const HISTORY_HALF_LIFE_WEEKS = 2;
const OBSERVATION_BUCKET_MS = 3_600_000;

export type ForecastWindow = "session" | "weekly";
export type ForecastStatus = "safe" | "watch" | "risk" | "unavailable";
export type ForecastConfidence = "high" | "low" | "none";
export type ForecastMethod = "linear" | "baseline" | "personalized" | "unavailable";

export interface UsageForecast {
  window: ForecastWindow;
  start: number;
  reset: number;
  calculatedAt: number;
  currentUtilization: number;
  projectedUtilizationAtReset: number;
  projectedRemainingAtReset: number;
  projectedLimitHitAt: number | null;
  status: ForecastStatus;
  confidence: ForecastConfidence;
  method: ForecastMethod;
  historyWeeks: number;
  historyBlend: number;
}

export interface ForecastWeekProfile {
  reset: number;
  finalUtilization: number;
  curve: Array<number | null>;
}

export interface ForecastProfile {
  version: 1;
  weeks: ForecastWeekProfile[];
  observations: ForecastObservation[];
}

export interface ForecastObservation {
  timestamp: number;
  utilization: number;
  reset: number;
}

export interface ForecastOptions {
  now?: number;
  minElapsedRatio?: number;
  watchRemainingPct?: number;
}

export const EMPTY_FORECAST_PROFILE: ForecastProfile = { version: 1, weeks: [], observations: [] };

export function parseIsoTime(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const parsed = Date.parse(isoDate);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyForecast(projectedUtilizationAtReset: number, confidence: ForecastConfidence, watchRemainingPct: number): ForecastStatus {
  if (confidence === "none") return "unavailable";
  if (projectedUtilizationAtReset > 100) return "risk";
  if (100 - projectedUtilizationAtReset <= watchRemainingPct) return "watch";
  return "safe";
}

export function describeForecastMethod(forecast: Pick<UsageForecast, "method" | "historyWeeks" | "historyBlend">): string {
  if (forecast.method === "linear") return "Linear";
  if (forecast.method === "baseline") return "Baseline";
  if (forecast.method !== "personalized") return "Unavailable";
  const weeks = `${forecast.historyWeeks} week${forecast.historyWeeks === 1 ? "" : "s"}`;
  return forecast.historyBlend < 1 ? `Personalized (${weeks} + baseline)` : `Personalized (${weeks})`;
}

function projectedHitTime(now: number, reset: number, current: number, projected: number): number | null {
  if (current >= 100) return now;
  if (projected <= 100 || projected <= current) return null;
  const hitAt = now + ((reset - now) * (100 - current)) / (projected - current);
  return hitAt < reset ? hitAt : null;
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

  return {
    window,
    start,
    reset,
    calculatedAt: now,
    currentUtilization,
    projectedUtilizationAtReset,
    projectedRemainingAtReset,
    projectedLimitHitAt: projectedHitTime(now, reset, currentUtilization, projectedUtilizationAtReset),
    status: classifyForecast(projectedUtilizationAtReset, confidence, watchRemainingPct),
    confidence,
    method: "linear",
    historyWeeks: 0,
    historyBlend: 0,
  };
}

export function getSessionForecast(usage: UsageResponse, now = Date.now()): UsageForecast | null {
  return getLinearForecast("session", usage.five_hour, FIVE_HOUR_MS, {
    now,
    minElapsedRatio: 0.2,
    watchRemainingPct: 10,
  });
}

function baselineWeeklyProjection(current: number, elapsedMs: number, remainingMs: number): number {
  const priorUsage = (100 * BASELINE_PRIOR_MS) / SEVEN_DAY_MS;
  const smoothedRate = (current + priorUsage) / (elapsedMs + BASELINE_PRIOR_MS);
  return current + smoothedRate * remainingMs;
}

function weightedMedian(values: Array<{ value: number; weight: number }>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const midpoint = sorted.reduce((sum, item) => sum + item.weight, 0) / 2;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= midpoint) return item.value;
  }
  return sorted[sorted.length - 1].value;
}

function historyProjection(profile: ForecastProfile, currentReset: number, elapsedMs: number, current: number): {
  projected: number;
  weeks: number;
  blend: number;
} | null {
  const bin = Math.max(0, Math.min(PROFILE_BIN_COUNT, Math.round(elapsedMs / PROFILE_BIN_MS)));
  const candidates = profile.weeks.flatMap((week) => {
    const atPhase = week.curve[bin];
    if (atPhase === null || atPhase === undefined || week.reset >= currentReset) return [];
    const ageWeeks = Math.max(1, (currentReset - week.reset) / SEVEN_DAY_MS);
    return [{
      value: Math.max(0, week.finalUtilization - atPhase),
      weight: 2 ** (-ageWeeks / HISTORY_HALF_LIFE_WEEKS),
    }];
  });
  const remaining = weightedMedian(candidates);
  if (remaining === null) return null;
  const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);
  return {
    projected: current + remaining,
    weeks: candidates.length,
    blend: Math.min(1, totalWeight / FULL_HISTORY_WEIGHT),
  };
}

export function getWeeklyForecast(usage: UsageResponse, now = Date.now(), profile: ForecastProfile = EMPTY_FORECAST_PROFILE): UsageForecast | null {
  const bucket = usage.seven_day;
  const reset = parseIsoTime(bucket?.resets_at);
  if (!bucket || reset === null || now >= reset) return null;
  const start = reset - SEVEN_DAY_MS;
  const elapsedMs = now - start;
  if (elapsedMs <= 0) return null;

  const remainingMs = reset - now;
  const current = bucket.utilization;
  const baseline = baselineWeeklyProjection(current, elapsedMs, remainingMs);
  const historical = historyProjection(profile, reset, elapsedMs, current);
  const blend = historical?.blend ?? 0;
  const projected = historical
    ? baseline * (1 - blend) + historical.projected * blend
    : baseline;
  const confidence: ForecastConfidence = blend >= 1 ? "high" : "low";

  return {
    window: "weekly",
    start,
    reset,
    calculatedAt: now,
    currentUtilization: current,
    projectedUtilizationAtReset: projected,
    projectedRemainingAtReset: 100 - projected,
    projectedLimitHitAt: projectedHitTime(now, reset, current, projected),
    status: classifyForecast(projected, confidence, 10),
    confidence,
    method: historical ? "personalized" : "baseline",
    historyWeeks: historical?.weeks ?? 0,
    historyBlend: blend,
  };
}

function sampleCurve(points: Array<{ timestamp: number; utilization: number }>, start: number, reset: number): Array<number | null> {
  const curve: Array<number | null> = Array.from({ length: PROFILE_BIN_COUNT + 1 }, () => null);
  let runningMax = 0;
  const monotonic = points.map((point) => {
    runningMax = Math.max(runningMax, point.utilization);
    return { timestamp: point.timestamp, utilization: runningMax };
  });
  const withBounds = [{ timestamp: start, utilization: 0 }, ...monotonic];
  curve[0] = 0;
  curve[PROFILE_BIN_COUNT] = monotonic[monotonic.length - 1].utilization;

  for (let bin = 1; bin < PROFILE_BIN_COUNT; bin += 1) {
    const target = start + bin * PROFILE_BIN_MS;
    const afterIndex = withBounds.findIndex((point) => point.timestamp >= target);
    if (afterIndex <= 0) continue;
    const before = withBounds[afterIndex - 1];
    const after = withBounds[afterIndex];
    const gap = after.timestamp - before.timestamp;
    if (gap > MAX_INTERPOLATION_GAP_MS || after.timestamp > reset) continue;
    const ratio = gap === 0 ? 1 : (target - before.timestamp) / gap;
    curve[bin] = before.utilization + (after.utilization - before.utilization) * ratio;
  }
  return curve;
}

function buildWeekProfile(reset: number, observations: ForecastObservation[]): ForecastWeekProfile | null {
  const start = reset - SEVEN_DAY_MS;
  const points = observations
    .filter((entry) => entry.timestamp >= start && entry.timestamp < reset)
    .map((entry) => ({ timestamp: entry.timestamp, utilization: entry.utilization }))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (points.length < 4) return null;
  if (points[0].timestamp - start > PROFILE_COVERAGE_TOLERANCE_MS) return null;
  if (reset - points[points.length - 1].timestamp > PROFILE_COVERAGE_TOLERANCE_MS) return null;
  const curve = sampleCurve(points, start, reset);
  return { reset, finalUtilization: curve[PROFILE_BIN_COUNT] as number, curve };
}

export function updateForecastProfile(
  profile: ForecastProfile | undefined,
  entries: HistoryEntry[],
  now = Date.now(),
  onIncompleteWeek?: (reset: number, sampleCount: number) => void,
): ForecastProfile {
  const current = profile?.version === 1 ? profile : EMPTY_FORECAST_PROFILE;
  const knownResets = new Set(current.weeks.map((week) => week.reset));
  const incoming = entries.flatMap((entry): ForecastObservation[] => {
    const reset = parseIsoTime(entry.seven_day_resets_at);
    return reset !== null && entry.seven_day !== null
      ? [{ timestamp: entry.timestamp, utilization: entry.seven_day, reset }]
      : [];
  });
  const deduplicated = new Map<string, ForecastObservation>();
  for (const observation of [...(current.observations ?? []), ...incoming]) {
    deduplicated.set(`${observation.timestamp}:${observation.reset}`, observation);
  }
  const compacted = new Map<string, ForecastObservation>();
  for (const observation of deduplicated.values()) {
    const start = observation.reset - SEVEN_DAY_MS;
    const bucket = Math.floor((observation.timestamp - start) / OBSERVATION_BUCKET_MS);
    const key = `${observation.reset}:${bucket}`;
    const existing = compacted.get(key);
    if (!existing || observation.timestamp > existing.timestamp) compacted.set(key, observation);
  }
  const allObservations = [...compacted.values()];
  const entriesByReset = new Map<number, ForecastObservation[]>();
  for (const observation of allObservations) {
    if (observation.reset > now || knownResets.has(observation.reset)) continue;
    const group = entriesByReset.get(observation.reset) ?? [];
    group.push(observation);
    entriesByReset.set(observation.reset, group);
  }

  const added = [...entriesByReset.entries()].flatMap(([reset, grouped]) => {
    const week = buildWeekProfile(reset, grouped);
    if (!week) {
      // The reset already passed, so these samples will never be revisited — this week's
      // usage pattern is permanently excluded from personalization once discarded here.
      onIncompleteWeek?.(reset, grouped.length);
      return [];
    }
    return [week];
  });
  const weeks = [...current.weeks, ...added]
    .sort((a, b) => b.reset - a.reset)
    .slice(0, MAX_PROFILE_WEEKS);
  const observations = allObservations
    .filter((observation) => observation.reset > now)
    .sort((a, b) => a.timestamp - b.timestamp);
  return { version: 1, weeks, observations };
}
