import { isCacheFresh, type CacheEntry } from "./cache";
import { getWeeklyForecast, updateForecastProfile, type ForecastProfile, type UsageForecast } from "./forecast";
import { getScopedWeeklyLimits } from "./scopedLimits";
import type { Action } from "./statusBar";
import type { HistoryEntry, UsageResponse } from "./types";

export function toHistoryEntry(usage: UsageResponse, timestamp: number): HistoryEntry {
  return {
    timestamp,
    five_hour: usage.five_hour?.utilization ?? null,
    five_hour_resets_at: usage.five_hour?.resets_at ?? null,
    seven_day: usage.seven_day?.utilization ?? null,
    seven_day_resets_at: usage.seven_day?.resets_at ?? null,
    scoped_weekly: getScopedWeeklyLimits(usage),
    extra_used: usage.extra_usage?.used_credits ?? null,
    extra_limit: usage.extra_usage?.monthly_limit ?? null,
  };
}

export interface RefreshLog {
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface RefreshDependencies {
  /** The config dir in effect right now; it changes when the user switches accounts mid-refresh. */
  getConfigDir: () => string | undefined;
  readCache: (configDir: string | undefined) => CacheEntry | null;
  writeCache: (usage: UsageResponse, configDir: string | undefined, fetchedAt: number) => void;
  getAccessToken: (configDir: string | undefined) => string | null;
  fetchUsage: (token: string) => Promise<UsageResponse>;
  getForecastProfile: () => ForecastProfile;
  /** Keeps the profile for the current config dir; must pick the storage key before it awaits anything. */
  saveForecastProfile: (profile: ForecastProfile) => PromiseLike<void>;
  /** Appends to the current config dir's history. */
  appendHistory: (entry: HistoryEntry) => void;
  /** Shows a successful refresh in the history view and the status bar. */
  showUsage: (usage: UsageResponse, forecast: UsageForecast | null) => void;
  dispatch: (action: Action) => void;
  getRefreshIntervalSeconds: () => number;
  onIncompleteForecastWeek: (reset: number, sampleCount: number) => void;
  log: RefreshLog;
  now: () => number;
}

export async function refreshUsage(deps: RefreshDependencies, force = false): Promise<void> {
  const refreshStartedAt = deps.now();
  deps.dispatch({ type: "refresh-started" });

  // A config dir change during an await makes this refresh stale: its results belong to the previous
  // account, and the change already started a refresh for the new one.
  const refreshConfigDir = deps.getConfigDir();
  const isStale = (step: string) => {
    const stale = deps.getConfigDir() !== refreshConfigDir;
    if (stale) {
      deps.log.debug(`Config dir changed during ${step} — discarding the previous account's refresh`);
    }
    return stale;
  };

  const cached = deps.readCache(refreshConfigDir);
  if (!force && cached && isCacheFresh(cached, deps.getRefreshIntervalSeconds(), refreshStartedAt)) {
    const ageSeconds = Math.round((refreshStartedAt - cached.fetchedAt) / 1000);
    deps.log.debug(`Cache hit (${ageSeconds}s old) — skipping API call`);
    const profile = updateForecastProfile(deps.getForecastProfile(), [toHistoryEntry(cached.data, cached.fetchedAt)], refreshStartedAt, deps.onIncompleteForecastWeek);
    await deps.saveForecastProfile(profile);
    if (isStale("cache hit")) {
      return;
    }
    deps.showUsage(cached.data, getWeeklyForecast(cached.data, refreshStartedAt, profile));
    return;
  }

  deps.log.debug(force ? "Forced refresh — fetching from API" : "Cache missing or stale — fetching from API");
  const token = deps.getAccessToken(refreshConfigDir);
  if (!token) {
    deps.log.warn("No valid access token found — run `claude /login` to sign in");
    deps.dispatch({ type: "no-token" });
    return;
  }
  try {
    const usage = await deps.fetchUsage(token);
    if (isStale("fetch")) {
      return;
    }
    deps.writeCache(usage, refreshConfigDir, refreshStartedAt);
    deps.log.info("Usage fetched successfully");
    const entry = toHistoryEntry(usage, deps.now());
    const profile = updateForecastProfile(deps.getForecastProfile(), [entry], entry.timestamp, deps.onIncompleteForecastWeek);
    // Persist reset metadata alongside utilization so the history view can derive markers and forecasts later.
    // Appended before the await below, so a config dir change during it can't redirect the entry.
    deps.appendHistory(entry);
    await deps.saveForecastProfile(profile);
    if (isStale("forecast update")) {
      return;
    }
    deps.showUsage(usage, getWeeklyForecast(usage, entry.timestamp, profile));
  } catch (e) {
    if (isStale("failed fetch")) {
      return;
    }
    deps.log.error(`Unexpected error during fetch: ${String(e)}`);
    deps.dispatch({ type: "fetch-error", message: String(e) });
  }
}
