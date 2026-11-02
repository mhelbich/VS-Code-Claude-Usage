import test from "node:test";
import assert from "node:assert/strict";

import { describeUnhandledFields, getScopedShares, getScopedWeeklyLimits } from "../scopedLimits.js";
import { MAX20_SESSION, PRO_EUR_EXTRA, ULTRA_NO_SESSION } from "./usageFixtures.js";

test("extracts all valid named weekly scoped limits", () => {
  const result = getScopedWeeklyLimits({
    limits: [
      {
        kind: "weekly_scoped",
        percent: 22,
        resets_at: "2026-07-03T02:00:00.208968+00:00",
        scope: { model: { id: null, display_name: "Fable" } },
        is_active: false,
      },
      {
        kind: "weekly_scoped",
        percent: 10,
        resets_at: null,
        scope: { model: { id: "model-2", display_name: "Another Model" } },
      },
      { kind: "weekly_all", percent: 32, scope: null },
    ],
  });

  assert.deepEqual(result, [
    { model_id: null, display_name: "Fable", percent: 22, resets_at: "2026-07-03T02:00:00.208968+00:00" },
    { model_id: "model-2", display_name: "Another Model", percent: 10, resets_at: null },
  ]);
});

test("ignores absent and malformed scoped limits", () => {
  assert.deepEqual(getScopedWeeklyLimits({}), []);
  assert.deepEqual(getScopedWeeklyLimits({ limits: null }), []);
  assert.deepEqual(
    getScopedWeeklyLimits({
      limits: [
        { kind: "weekly_scoped", percent: null, scope: { model: { display_name: "Fable" } } },
        { kind: "weekly_scoped", percent: Number.NaN, scope: { model: { display_name: "Fable" } } },
        { kind: "weekly_scoped", percent: 101, scope: { model: { display_name: "Fable" } } },
        { kind: "weekly_scoped", percent: 20, scope: { model: { display_name: "  " } } },
      ],
    }),
    [],
  );
});

test("getScopedShares resolves limit_index against the current limits array", () => {
  // Fable sits at index 2 with a session limit and at index 1 without one.
  assert.deepEqual([...getScopedShares(MAX20_SESSION)], [["name:Fable", 50]]);
  assert.deepEqual([...getScopedShares(ULTRA_NO_SESSION)], [["name:Fable", 50]]);
});

test("getScopedShares ignores shares pointing at missing or non-scoped limits", () => {
  assert.deepEqual([...getScopedShares({ ...ULTRA_NO_SESSION, weekly_scoped_shares: [{ limit_index: 0, allowance_percent_of_weekly: 50 }] })], []);
  assert.deepEqual([...getScopedShares({ ...ULTRA_NO_SESSION, weekly_scoped_shares: [{ limit_index: 9, allowance_percent_of_weekly: 50 }] })], []);
  assert.deepEqual([...getScopedShares(PRO_EUR_EXTRA)], []);
});

test("describeUnhandledFields reports unknown non-null fields and nothing for known shapes", () => {
  assert.deepEqual(describeUnhandledFields(PRO_EUR_EXTRA), []);
  assert.deepEqual(describeUnhandledFields(MAX20_SESSION), []);

  const notes = describeUnhandledFields(ULTRA_NO_SESSION);
  assert.equal(notes.length, 1);
  assert.match(notes[0] ?? "", /^unhandled field iguana_necktie: \{.*"limit_dollars":250/);
});

test("describeUnhandledFields reports unknown kinds, dropped scoped limits, locks, and severity", () => {
  const notes = describeUnhandledFields({
    five_hour: { utilization: 100, resets_at: null, locked_reason: "rate_limited" },
    spend: { enabled: true, severity: "warning" },
    limits: [
      { kind: "monthly_all", percent: 10 },
      { kind: "weekly_scoped", percent: 10, scope: { model: null, surface: { key: "claude_code" } } },
      { kind: "weekly_all", percent: 95, severity: "critical" },
    ],
  });

  assert.deepEqual(notes.map((note) => note.split(":")[0]), [
    "five_hour locked_reason",
    "spend severity",
    "unhandled limit [0] kind \"monthly_all\"",
    "dropped weekly_scoped limit [1]",
    "limit [2] weekly_all severity",
  ]);
});
