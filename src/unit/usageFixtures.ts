// Trimmed real /api/oauth/usage responses (2026-11-02). Null codename keys are omitted.
import type { UsageResponse } from "../types";

/** Pro, extra usage enabled in EUR, has a 5h session limit. */
export const PRO_EUR_EXTRA: UsageResponse = {
  five_hour: { utilization: 12.0, resets_at: "2026-11-02T16:50:00.267065+00:00", locked_reason: null },
  seven_day: { utilization: 39.0, resets_at: "2026-11-06T02:00:00.267091+00:00", locked_reason: null },
  extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 0.0, utilization: null, currency: "EUR", decimal_places: 2 },
  limits: [
    { kind: "session", group: "session", percent: 12, severity: "normal", resets_at: "2026-11-02T16:50:00.267065+00:00", scope: null, is_active: false },
    { kind: "weekly_all", group: "weekly", percent: 39, severity: "normal", resets_at: "2026-11-06T02:00:00.267091+00:00", scope: null, is_active: true },
  ],
  spend: {
    used: { amount_minor: 0, currency: "EUR", exponent: 2 },
    limit: { amount_minor: 2000, currency: "EUR", exponent: 2 },
    percent: 0,
    severity: "normal",
    enabled: true,
  },
  seven_day_breakdown: null,
  weekly_scoped_shares: null,
};

/** Max 20x, extra usage disabled, has a session limit, Fable at limits[2], breakdown 99/1. */
export const MAX20_SESSION: UsageResponse = {
  five_hour: { utilization: 7.0, resets_at: "2026-11-02T14:39:59.730702+00:00", locked_reason: null },
  seven_day: { utilization: 9.0, resets_at: "2026-11-07T13:59:59.730721+00:00", locked_reason: null },
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null, decimal_places: null },
  limits: [
    { kind: "session", group: "session", percent: 7, severity: "normal", resets_at: "2026-11-02T14:39:59.730702+00:00", scope: null, is_active: false },
    { kind: "weekly_all", group: "weekly", percent: 9, severity: "normal", resets_at: "2026-11-07T13:59:59.730721+00:00", scope: null, is_active: true },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 0,
      severity: "normal",
      resets_at: "2026-11-07T14:00:00+00:00",
      scope: { model: { id: null, display_name: "Fable" }, surface: null },
      is_active: false,
    },
  ],
  spend: { used: { amount_minor: 0, currency: "USD", exponent: 2 }, limit: null, percent: 0, severity: "normal", enabled: false },
  seven_day_breakdown: {
    rows: [
      { key: "claude_code", display_name: "Claude Code", percent: 99 },
      { key: "chat", display_name: "Chats", percent: 0 },
      { key: "cowork", display_name: "Cowork", percent: 1 },
      { key: "other", display_name: "Other", percent: 0 },
    ],
  },
  weekly_scoped_shares: [{ limit_index: 2, used_percent_of_weekly: 0, allowance_percent_of_weekly: 50 }],
};

/** Ultra (verified), no 5h limit, Fable at limits[1], breakdown 100/0, unknown `iguana_necktie` bucket. */
export const ULTRA_NO_SESSION: UsageResponse = {
  five_hour: null,
  seven_day: { utilization: 46.0, resets_at: "2026-11-02T21:00:00.184024+00:00", locked_reason: null },
  iguana_necktie: {
    utilization: 0.0,
    resets_at: "2026-11-05T07:59:00+00:00",
    limit_dollars: 250,
    used_dollars: 0.0,
    remaining_dollars: 250.0,
    locked_reason: null,
  },
  seven_day_opus: null,
  tangelo: null,
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null, decimal_places: null },
  limits: [
    { kind: "weekly_all", group: "weekly", percent: 46, severity: "normal", resets_at: "2026-11-02T21:00:00.184024+00:00", scope: null, is_active: true },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 0,
      severity: "normal",
      resets_at: "2026-11-02T21:00:00+00:00",
      scope: { model: { id: null, display_name: "Fable" }, surface: null },
      is_active: false,
    },
  ],
  spend: { used: { amount_minor: 0, currency: "USD", exponent: 2 }, limit: null, percent: 0, severity: "normal", enabled: false },
  member_dashboard_available: false,
  seven_day_breakdown: {
    rows: [
      { key: "claude_code", display_name: "Claude Code", percent: 100 },
      { key: "chat", display_name: "Chats", percent: 0 },
      { key: "cowork", display_name: "Cowork", percent: 0 },
      { key: "other", display_name: "Other", percent: 0 },
    ],
  },
  weekly_scoped_shares: [{ limit_index: 1, used_percent_of_weekly: 0, allowance_percent_of_weekly: 50 }],
} as UsageResponse;
