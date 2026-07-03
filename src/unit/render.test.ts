import test from "node:test";
import assert from "node:assert/strict";

import { buildStatusText, buildTooltipMarkdown, formatReset, getSessionStart, getWeeklyForecast, makeHtmlBar, makeUsageBar, utilColor } from "../render";
import { ColorThresholds, UsageResponse } from "../types";

const thresholds: ColorThresholds = {
  warning: 60,
  danger: 90,
};

test("utilColor returns green, yellow, and red at configured thresholds", () => {
  assert.equal(utilColor(10, thresholds), "🟢");
  assert.equal(utilColor(60, thresholds), "🟡");
  assert.equal(utilColor(90, thresholds), "🔴");
});

test("makeHtmlBar renders colored remaining and used segments", () => {
  const bar = makeHtmlBar(50, 60, thresholds, 10);

  assert.match(bar, /color:#cca700/);
  assert.match(bar, /color:#555555/);
  assert.equal((bar.match(/█/g) ?? []).length, 10);
});

test("makeUsageBar renders a stable used-scale marker", () => {
  const bar = makeUsageBar(50, thresholds, 10, 80, "risk");

  assert.equal((bar.match(/█/g) ?? []).length, 5);
  assert.equal((bar.match(/░/g) ?? []).length, 4);
  assert.match(bar, /color:#f44747;">│<\/span>/);
});

test("formatReset handles missing, past, and future reset times", () => {
  assert.equal(formatReset(null), "—");
  assert.equal(formatReset("2026-03-16T10:00:00.000Z", { now: Date.parse("2026-03-16T10:05:00.000Z") }), "resetting…");
  assert.equal(
    formatReset("2026-03-16T12:30:00.000Z", {
      now: Date.parse("2026-03-16T10:00:00.000Z"),
      formatAbsolute: () => "Mon, Mar 16, 12:30 PM",
    }),
    "2h 30m (Mon, Mar 16, 12:30 PM)",
  );
});

test("getSessionStart derives the five-hour window start from the reset time", () => {
  assert.equal(getSessionStart("2026-03-16T12:00:00.000Z"), Date.parse("2026-03-16T07:00:00.000Z"));
  assert.equal(getSessionStart(null), null);
});

test("getWeeklyForecast returns null when weekly reset data is unavailable", () => {
  assert.equal(getWeeklyForecast({}), null);
  assert.equal(getWeeklyForecast({ seven_day: { utilization: 25, resets_at: null } }), null);
});

test("getWeeklyForecast uses the regularized baseline for weekly projection", () => {
  const forecast = getWeeklyForecast(
    {
      seven_day: { utilization: 40, resets_at: "2026-03-23T00:00:00.000Z" },
    },
    Date.parse("2026-03-18T00:00:00.000Z"),
  );

  assert.ok(forecast);
  assert.equal(forecast.start, Date.parse("2026-03-16T00:00:00.000Z"));
  assert.equal(forecast.reset, Date.parse("2026-03-23T00:00:00.000Z"));
  assert.equal(forecast.currentUtilization, 40);
  assert.equal(forecast.projectedUtilizationAtReset, 125.71428571428571);
  assert.equal(forecast.projectedRemainingAtReset, -25.714285714285708);
  assert.equal(forecast.projectedLimitHitAt, Date.parse("2026-03-21T12:00:00.000Z"));
  assert.equal(forecast.status, "risk");
  assert.equal(forecast.method, "baseline");
});

test("getWeeklyForecast stays safe when usage is on pace or zero", () => {
  const onPace = getWeeklyForecast(
    {
      seven_day: { utilization: 50, resets_at: "2026-03-23T00:00:00.000Z" },
    },
    Date.parse("2026-03-19T12:00:00.000Z"),
  );

  assert.ok(onPace);
  assert.equal(onPace.projectedUtilizationAtReset, 100);
  assert.equal(onPace.projectedLimitHitAt, null);

  const zero = getWeeklyForecast(
    {
      seven_day: { utilization: 0, resets_at: "2026-03-23T00:00:00.000Z" },
    },
    Date.parse("2026-03-18T00:00:00.000Z"),
  );

  assert.ok(zero);
  assert.equal(zero.projectedUtilizationAtReset, 35.714285714285715);
  assert.equal(zero.projectedLimitHitAt, null);
});

test("buildStatusText shows both session and weekly remaining percentages", () => {
  const usage: UsageResponse = {
    five_hour: { utilization: 18, resets_at: null },
    seven_day: { utilization: 62, resets_at: null },
  };

  assert.equal(buildStatusText(usage, thresholds), "$(pulse) 🟢 S: 82% │ 🟡 W: 38%");
});

test("buildStatusText falls back when no usage buckets are present", () => {
  assert.equal(buildStatusText({}, thresholds), "$(pulse) Claude —");
});

test("buildStatusText shows used % when showUsed is true", () => {
  const usage: UsageResponse = {
    five_hour: { utilization: 18, resets_at: null },
    seven_day: { utilization: 62, resets_at: null },
  };

  assert.equal(buildStatusText(usage, thresholds, true), "$(pulse) 🟢 S: 18% │ 🟡 W: 62%");
});

test("buildStatusText shows remaining % when showUsed is false", () => {
  const usage: UsageResponse = {
    five_hour: { utilization: 18, resets_at: null },
    seven_day: { utilization: 62, resets_at: null },
  };

  assert.equal(buildStatusText(usage, thresholds, false), "$(pulse) 🟢 S: 82% │ 🟡 W: 38%");
});

test("buildStatusText does not append a weekly pace indicator when reset data is available", () => {
  const usage: UsageResponse = {
    five_hour: { utilization: 18, resets_at: null },
    seven_day: { utilization: 40, resets_at: "2026-03-23T00:00:00.000Z" },
  };

  assert.equal(
    buildStatusText(usage, thresholds, false, Date.parse("2026-03-18T00:00:00.000Z")),
    "$(pulse) 🟢 S: 82% │ 🟢 W: 60%",
  );
});

test("buildStatusText leaves forecast signaling to the separate forecast item", () => {
  const underPace: UsageResponse = {
    seven_day: { utilization: 20, resets_at: "2026-03-23T00:00:00.000Z" },
  };
  const onPace: UsageResponse = {
    seven_day: { utilization: 28, resets_at: "2026-03-23T00:00:00.000Z" },
  };

  assert.equal(buildStatusText(underPace, thresholds, false, Date.parse("2026-03-18T00:00:00.000Z")), "$(pulse) 🟢 W: 80%");
  assert.equal(buildStatusText(onPace, thresholds, false, Date.parse("2026-03-18T00:00:00.000Z")), "$(pulse) 🟢 W: 72%");
});

test("buildTooltipMarkdown renders all enabled sections", () => {
  const usage: UsageResponse = {
    five_hour: { utilization: 25, resets_at: "2026-03-16T12:30:00.000Z" },
    seven_day: { utilization: 70, resets_at: "2026-03-18T10:15:00.000Z" },
    limits: [{
      kind: "weekly_scoped",
      percent: 40,
      resets_at: null,
      scope: { model: { id: null, display_name: "Fable" } },
    }],
    extra_usage: {
      is_enabled: true,
      monthly_limit: 100,
      used_credits: 25,
      utilization: 25,
    },
  };

  const tooltip = buildTooltipMarkdown(usage, thresholds, {
    now: Date.parse("2026-03-16T10:00:00.000Z"),
    formatAbsolute: (date) => date.toISOString(),
  });

  assert.match(tooltip, /### Claude Code Usage/);
  assert.match(tooltip, /\*\*Session \(5h\)\*\*/);
  assert.match(tooltip, /\*\*Weekly \(7d\)\*\*/);
  assert.match(tooltip, /\*\*Fable \(7d\)\*\*/);
  assert.match(tooltip, /\*\*Extra usage:\*\* 25 \/ 100 credits/);
  assert.match(tooltip, /Resets in 2h 30m \(2026-03-16T12:30:00.000Z\)/);
  assert.match(tooltip, /Forecast: projected remaining at reset is 1\.6%/);
  assert.match(tooltip, /│/);
  assert.match(tooltip, /Click to refresh/);
});

test("buildTooltipMarkdown can hide scoped weekly limits", () => {
  const usage: UsageResponse = {
    limits: [{
      kind: "weekly_scoped",
      percent: 40,
      resets_at: null,
      scope: { model: { display_name: "Fable" } },
    }],
  };

  assert.doesNotMatch(buildTooltipMarkdown(usage, thresholds, undefined, false, false), /Fable/);
});

test("buildTooltipMarkdown shows disabled extra usage when not enabled", () => {
  const tooltip = buildTooltipMarkdown({}, thresholds);

  assert.match(tooltip, /\*\*Extra usage:\*\* ✗ not enabled/);
});

test("buildTooltipMarkdown shows used % and 'used' label when showUsed is true", () => {
  const usage: UsageResponse = {
    five_hour: { utilization: 25, resets_at: null },
    seven_day: { utilization: 70, resets_at: "2026-03-18T10:15:00.000Z" },
  };

  const tooltip = buildTooltipMarkdown(usage, thresholds, {
    now: Date.parse("2026-03-16T10:00:00.000Z"),
    formatAbsolute: (date) => date.toISOString(),
  }, true);

  assert.match(tooltip, /\*\*25\.0%\*\* used/);
  assert.match(tooltip, /\*\*70\.0%\*\* used/);
  assert.match(tooltip, /Forecast: projected usage at reset is 98\.4%/);
  assert.doesNotMatch(tooltip, /remaining/);
});

test("buildTooltipMarkdown keeps the html bar on a stable used scale", () => {
  const usage: UsageResponse = { five_hour: { utilization: 25, resets_at: null } };

  const tooltipRemaining = buildTooltipMarkdown(usage, thresholds, undefined, false);
  const tooltipUsed = buildTooltipMarkdown(usage, thresholds, undefined, true);

  const countColored = (tooltip: string) => {
    return (tooltip.match(/color:#4EC9B0;">█<\/span>/g) ?? []).length;
  };

  assert.equal(countColored(tooltipRemaining), 5, "remaining mode keeps the bar in used-space");
  assert.equal(countColored(tooltipUsed), 5, "used mode: 25% of 20 blocks should be colored");
});

test("buildTooltipMarkdown shows remaining % and 'remaining' label when showUsed is false", () => {
  const usage: UsageResponse = {
    five_hour: { utilization: 25, resets_at: null },
    seven_day: { utilization: 70, resets_at: "2026-03-18T10:15:00.000Z" },
  };

  const tooltip = buildTooltipMarkdown(usage, thresholds, {
    now: Date.parse("2026-03-16T10:00:00.000Z"),
    formatAbsolute: (date) => date.toISOString(),
  }, false);

  assert.match(tooltip, /\*\*75\.0%\*\* remaining/);
  assert.match(tooltip, /\*\*30\.0%\*\* remaining/);
  assert.match(tooltip, /Forecast: projected remaining at reset is 1\.6%/);
  assert.doesNotMatch(tooltip, / used/);
});

test("buildTooltipMarkdown warns when the weekly limit projects to hit before reset", () => {
  const tooltip = buildTooltipMarkdown(
    {
      seven_day: { utilization: 45, resets_at: "2026-03-23T00:00:00.000Z" },
    },
    thresholds,
    {
      now: Date.parse("2026-03-18T00:00:00.000Z"),
      formatAbsolute: (date) => date.toISOString(),
    },
    false,
  );

  assert.match(tooltip, /Forecast: At current pace, remaining projects to reach 0 in 71h 46m \(2026-03-20T23:46:01\.165Z\) before reset\./);
});
