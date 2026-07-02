import test from "node:test";
import assert from "node:assert/strict";

import { getScopedWeeklyLimits } from "../scopedLimits.js";

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
