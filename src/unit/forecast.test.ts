import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_FORECAST_PROFILE,
  SEVEN_DAY_MS,
  getWeeklyForecast,
  updateForecastProfile,
  type ForecastProfile,
  type ForecastWeekProfile,
} from "../forecast";
import type { HistoryEntry } from "../types";

const FOUR_HOURS_MS = 4 * 3_600_000;

function historyEntry(timestamp: number, reset: number, utilization: number): HistoryEntry {
  return {
    timestamp,
    five_hour: null,
    seven_day: utilization,
    seven_day_resets_at: new Date(reset).toISOString(),
    extra_used: null,
    extra_limit: null,
  };
}

function weekProfile(reset: number, atPhase: number, finalUtilization: number): ForecastWeekProfile {
  const curve: Array<number | null> = Array.from({ length: 43 }, () => null);
  curve[0] = 0;
  curve[2] = atPhase;
  curve[42] = finalUtilization;
  return { reset, finalUtilization, curve };
}

test("baseline forecast regularizes heavy usage immediately after reset", () => {
  const start = Date.parse("2026-07-03T04:00:00+02:00");
  const reset = start + SEVEN_DAY_MS;
  const now = start + 6 * 3_600_000;
  const forecast = getWeeklyForecast({
    seven_day: { utilization: 14, resets_at: new Date(reset).toISOString() },
  }, now);

  assert.ok(forecast);
  assert.equal(forecast.method, "baseline");
  assert.ok(forecast.projectedLimitHitAt !== null);
  assert.ok(forecast.projectedLimitHitAt - now > 4 * 86_400_000, "the limit is not projected for Sunday");
});

test("personal history replaces the baseline once its effective weight is sufficient", () => {
  const reset = Date.parse("2026-07-10T02:00:00.000Z");
  const now = reset - SEVEN_DAY_MS + 6 * 3_600_000;
  const profile: ForecastProfile = {
    version: 1,
    observations: [],
    weeks: [1, 2, 3].map((age) => weekProfile(reset - age * SEVEN_DAY_MS, 10, 50)),
  };
  const forecast = getWeeklyForecast({
    seven_day: { utilization: 14, resets_at: new Date(reset).toISOString() },
  }, now, profile);

  assert.ok(forecast);
  assert.equal(forecast.method, "personalized");
  assert.equal(forecast.historyWeeks, 3);
  assert.equal(forecast.historyBlend, 1);
  assert.equal(forecast.projectedUtilizationAtReset, 54);
  assert.equal(forecast.projectedLimitHitAt, null);
});

test("an old outlier has little influence on the weighted median", () => {
  const reset = Date.parse("2026-07-10T02:00:00.000Z");
  const now = reset - SEVEN_DAY_MS + 6 * 3_600_000;
  const profile: ForecastProfile = {
    version: 1,
    observations: [],
    weeks: [
      weekProfile(reset - SEVEN_DAY_MS, 10, 50),
      weekProfile(reset - 2 * SEVEN_DAY_MS, 10, 50),
      weekProfile(reset - 8 * SEVEN_DAY_MS, 0, 100),
    ],
  };
  const forecast = getWeeklyForecast({
    seven_day: { utilization: 14, resets_at: new Date(reset).toISOString() },
  }, now, profile);

  assert.ok(forecast);
  assert.ok(forecast.projectedUtilizationAtReset < 70);
});

test("profile observations survive independently of chart history and finalize at reset", () => {
  const reset = Date.parse("2026-03-16T00:00:00.000Z");
  const start = reset - SEVEN_DAY_MS;
  let profile = EMPTY_FORECAST_PROFILE;

  for (let bin = 0; bin < 42; bin += 1) {
    const timestamp = start + bin * FOUR_HOURS_MS;
    profile = updateForecastProfile(profile, [historyEntry(timestamp, reset, bin)], timestamp);
  }
  assert.equal(profile.weeks.length, 0);
  assert.equal(profile.observations.length, 42);

  profile = updateForecastProfile(profile, [], reset);
  assert.equal(profile.weeks.length, 1);
  assert.equal(profile.observations.length, 0);
  assert.equal(profile.weeks[0].finalUtilization, 41);
});

test("incomplete weeks are reported via onIncompleteWeek and their samples are dropped", () => {
  const reset = Date.parse("2026-03-16T00:00:00.000Z");
  const start = reset - SEVEN_DAY_MS;
  const entries = [historyEntry(start, reset, 0), historyEntry(start + FOUR_HOURS_MS, reset, 5)];
  const dropped: Array<{ reset: number; sampleCount: number }> = [];

  const profile = updateForecastProfile(EMPTY_FORECAST_PROFILE, entries, reset, (r, sampleCount) => {
    dropped.push({ reset: r, sampleCount });
  });

  assert.equal(profile.weeks.length, 0);
  assert.equal(profile.observations.length, 0, "samples for the passed week are not retried later");
  assert.deepEqual(dropped, [{ reset, sampleCount: 2 }]);
});

test("large offline gaps are not assigned to specific profile bins", () => {
  const reset = Date.parse("2026-03-16T00:00:00.000Z");
  const start = reset - SEVEN_DAY_MS;
  const bins = [0, 1, 5, ...Array.from({ length: 37 }, (_, index) => index + 6)];
  const entries = bins.map((bin) => historyEntry(start + bin * FOUR_HOURS_MS, reset, bin));
  const profile = updateForecastProfile(EMPTY_FORECAST_PROFILE, entries, reset);

  assert.equal(profile.weeks.length, 1);
  assert.equal(profile.weeks[0].curve[3], null);
  assert.equal(profile.weeks[0].curve[4], null);
});
