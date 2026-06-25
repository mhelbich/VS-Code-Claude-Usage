import test from "node:test";
import assert from "node:assert/strict";

import { forecastStateToBarProps, reduce, stateToBarProps, State } from "../statusBar";
import { buildStatusText, buildTooltipMarkdown } from "../render";
import { ColorThresholds, UsageResponse } from "../types";

const thresholds: ColorThresholds = { warning: 60, danger: 90 };

const usage: UsageResponse = {
  five_hour: { utilization: 18, resets_at: null },
  seven_day: { utilization: 62, resets_at: null },
};

// ─── reduce() tests ──────────────────────────────────────────────────────────

test("reduce: refresh-started returns loading from loading state", () => {
  const state: State = { kind: "loading" };
  assert.deepEqual(reduce(state, { type: "refresh-started" }), { kind: "loading" });
});

test("reduce: refresh-started preserves ok state to avoid flickering", () => {
  const state: State = { kind: "ok", usage, thresholds };
  assert.deepEqual(reduce(state, { type: "refresh-started" }), state);
});

test("reduce: refresh-started returns loading from error state", () => {
  const state: State = { kind: "error", message: "boom" };
  assert.deepEqual(reduce(state, { type: "refresh-started" }), { kind: "loading" });
});

test("reduce: fetch-success returns ok with usage and thresholds", () => {
  const state: State = { kind: "loading" };
  assert.deepEqual(reduce(state, { type: "fetch-success", usage, thresholds }), {
    kind: "ok",
    usage,
    thresholds,
  });
});

test("reduce: fetch-error returns error without message", () => {
  const state: State = { kind: "loading" };
  assert.deepEqual(reduce(state, { type: "fetch-error" }), { kind: "error", message: undefined });
});

test("reduce: fetch-error returns error with message", () => {
  const state: State = { kind: "loading" };
  assert.deepEqual(reduce(state, { type: "fetch-error", message: "Network error" }), {
    kind: "error",
    message: "Network error",
  });
});

test("reduce: no-token returns no-token", () => {
  const state: State = { kind: "loading" };
  assert.deepEqual(reduce(state, { type: "no-token" }), { kind: "no-token" });
});

test("reduce: thresholds-changed updates thresholds when ok", () => {
  const state: State = { kind: "ok", usage, thresholds };
  const newThresholds: ColorThresholds = { warning: 50, danger: 80 };
  const next = reduce(state, { type: "thresholds-changed", thresholds: newThresholds });
  assert.deepEqual(next, { kind: "ok", usage, thresholds: newThresholds });
});

test("reduce: thresholds-changed ignores when not ok (loading)", () => {
  const state: State = { kind: "loading" };
  const next = reduce(state, { type: "thresholds-changed", thresholds });
  assert.deepEqual(next, state);
});

test("reduce: thresholds-changed ignores when not ok (error)", () => {
  const state: State = { kind: "error", message: "oops" };
  const next = reduce(state, { type: "thresholds-changed", thresholds });
  assert.deepEqual(next, state);
});

test("reduce: thresholds-changed ignores when not ok (no-token)", () => {
  const state: State = { kind: "no-token" };
  const next = reduce(state, { type: "thresholds-changed", thresholds });
  assert.deepEqual(next, state);
});

// ─── stateToBarProps() tests ─────────────────────────────────────────────────

test("stateToBarProps: loading returns correct text and no backgroundColor", () => {
  const props = stateToBarProps({ kind: "loading" });
  assert.equal(props.text, "$(pulse) Claude …");
  assert.equal(props.tooltipIsMarkdown, false);
  assert.equal(props.color, undefined);
  assert.equal(props.backgroundColor, undefined);
});

test("stateToBarProps: no-token returns warning background and markdown tooltip", () => {
  const props = stateToBarProps({ kind: "no-token" });
  assert.equal(props.text, "$(pulse) Claude ✗");
  assert.equal(props.backgroundColor, "warning");
  assert.equal(props.tooltipIsMarkdown, true);
  assert.match(props.tooltipText, /claude \/login/);
});

test("stateToBarProps: error without message returns error background, non-markdown tooltip", () => {
  const props = stateToBarProps({ kind: "error" });
  assert.equal(props.text, "$(pulse) Claude !");
  assert.equal(props.backgroundColor, "error");
  assert.equal(props.tooltipIsMarkdown, false);
  assert.equal(props.tooltipText, "Claude Code: API error");
});

test("stateToBarProps: error with message returns error background, markdown tooltip with message", () => {
  const props = stateToBarProps({ kind: "error", message: "timeout" });
  assert.equal(props.backgroundColor, "error");
  assert.equal(props.tooltipIsMarkdown, true);
  assert.match(props.tooltipText, /timeout/);
});

test("stateToBarProps: ok returns no backgroundColor, text matches buildStatusText", () => {
  const props = stateToBarProps({ kind: "ok", usage, thresholds });
  assert.equal(props.backgroundColor, undefined);
  assert.equal(props.text, buildStatusText(usage, thresholds));
});

test("stateToBarProps: ok tooltip matches buildTooltipMarkdown", () => {
  const props = stateToBarProps({ kind: "ok", usage, thresholds });
  assert.equal(props.tooltipIsMarkdown, true);
  assert.equal(props.tooltipText, buildTooltipMarkdown(usage, thresholds));
});

test("stateToBarProps: ok with showUsed=true produces text matching buildStatusText with showUsed=true", () => {
  const props = stateToBarProps({ kind: "ok", usage, thresholds }, true);
  assert.equal(props.text, buildStatusText(usage, thresholds, true));
});

test("stateToBarProps: ok with showUsed=false produces text matching buildStatusText with showUsed=false", () => {
  const props = stateToBarProps({ kind: "ok", usage, thresholds }, false);
  assert.equal(props.text, buildStatusText(usage, thresholds, false));
});

test("stateToBarProps: ok with showUsed=true tooltip matches buildTooltipMarkdown with showUsed=true", () => {
  const props = stateToBarProps({ kind: "ok", usage, thresholds }, true);
  assert.equal(props.tooltipText, buildTooltipMarkdown(usage, thresholds, undefined, true));
});

test("forecastStateToBarProps: unavailable when state is not ok", () => {
  const props = forecastStateToBarProps({ kind: "loading" });

  assert.equal(props.text, "$(circle-filled)");
  assert.equal(props.color, "descriptionForeground");
  assert.equal(props.tooltipIsMarkdown, false);
  assert.equal(props.tooltipText, "Weekly forecast unavailable");
  assert.equal(props.visible, false);
});

test("forecastStateToBarProps: renders safe weekly forecast chip", () => {
  const now = Date.parse("2026-03-18T00:00:00.000Z");
  const props = forecastStateToBarProps(
    {
      kind: "ok",
      thresholds,
      usage: {
        seven_day: { utilization: 20, resets_at: "2026-03-23T00:00:00.000Z" },
      },
    },
    false,
    now,
  );

  assert.equal(props.text, "$(circle-filled)");
  assert.equal(props.color, "charts.green");
  assert.equal(props.tooltipIsMarkdown, true);
  assert.match(props.tooltipText, /### Weekly Forecast/);
  assert.match(props.tooltipText, /🟢 \*\*On track\*\*/);
  assert.match(props.tooltipText, /Projected at reset: \*\*30\.0% remaining\*\*/);
  assert.match(props.tooltipText, /Your current weekly pace looks safe\./);
  assert.match(props.tooltipText, /Reset: \*\*120h 0m/);
});

test("forecastStateToBarProps: renders risk weekly forecast chip", () => {
  const now = Date.parse("2026-03-18T00:00:00.000Z");
  const props = forecastStateToBarProps(
    {
      kind: "ok",
      thresholds,
      usage: {
        seven_day: { utilization: 45, resets_at: "2026-03-23T00:00:00.000Z" },
      },
    },
    true,
    now,
  );

  assert.equal(props.text, "$(circle-filled)");
  assert.equal(props.color, "charts.red");
  assert.match(props.tooltipText, /🔴 \*\*Limit risk\*\*/);
  assert.match(props.tooltipText, /weekly limit may be reached/);
  assert.match(props.tooltipText, /Projected at reset: \*\*100\.0% used\*\*/);
  assert.match(props.tooltipText, /Reset: \*\*120h 0m/);
});
