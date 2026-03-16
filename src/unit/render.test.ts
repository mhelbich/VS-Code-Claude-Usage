import test from "node:test";
import assert from "node:assert/strict";

import { buildStatusText, buildTooltipMarkdown, formatReset, makeHtmlBar, utilColor } from "../render";
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

test("buildTooltipMarkdown renders all enabled sections", () => {
  const usage: UsageResponse = {
    five_hour: { utilization: 25, resets_at: "2026-03-16T12:30:00.000Z" },
    seven_day: { utilization: 70, resets_at: "2026-03-18T10:15:00.000Z" },
    seven_day_opus: { utilization: 40, resets_at: null },
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
  assert.match(tooltip, /\*\*Opus \(7d\)\*\*/);
  assert.match(tooltip, /\*\*Extra usage:\*\* 25 \/ 100 credits/);
  assert.match(tooltip, /Resets in 2h 30m \(2026-03-16T12:30:00.000Z\)/);
  assert.match(tooltip, /Click to refresh/);
});

test("buildTooltipMarkdown shows disabled extra usage when not enabled", () => {
  const tooltip = buildTooltipMarkdown({}, thresholds);

  assert.match(tooltip, /\*\*Extra usage:\*\* ✗ not enabled/);
});
