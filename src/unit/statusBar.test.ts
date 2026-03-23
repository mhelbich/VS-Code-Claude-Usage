import test from "node:test";
import assert from "node:assert/strict";

import { reduce, stateToBarProps, State, Action } from "../statusBar";
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

test("reduce: refresh-started returns loading from ok state", () => {
  const state: State = { kind: "ok", usage, thresholds };
  assert.deepEqual(reduce(state, { type: "refresh-started" }), { kind: "loading" });
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
