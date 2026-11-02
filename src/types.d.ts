export interface UsageBucket {
  utilization: number; // 0–100
  resets_at: string | null;
  locked_reason?: unknown;
}

export interface ColorThresholds {
  warning: number; // utilization % for yellow
  danger: number; // utilization % for red
}

/** Monetary amount in minor units, e.g. { amount_minor: 2000, currency: "EUR", exponent: 2 } = €20.00. */
export interface Money {
  amount_minor: number;
  currency: string;
  exponent: number;
}

export interface UsageResponse {
  five_hour?: UsageBucket | null;
  seven_day?: UsageBucket | null;
  limits?: UsageLimit[] | null;
  /** Legacy extra-usage shape; amounts are in minor units (see `decimal_places`). Prefer `spend`. */
  extra_usage?: {
    is_enabled?: boolean | null;
    monthly_limit?: number | null;
    used_credits?: number | null;
    utilization?: number | null;
    currency?: string | null;
    decimal_places?: number | null;
  } | null;
  spend?: {
    used?: Money | null;
    limit?: Money | null;
    enabled?: boolean | null;
    percent?: number | null;
    severity?: string | null;
  } | null;
  seven_day_breakdown?: {
    rows?: Array<{
      key?: string | null;
      display_name?: string | null;
      percent?: number | null;
    }> | null;
  } | null;
  weekly_scoped_shares?: Array<{
    /** Index into `limits`. */
    limit_index?: number | null;
    used_percent_of_weekly?: number | null;
    allowance_percent_of_weekly?: number | null;
  }> | null;
}

export interface UsageLimit {
  kind?: string | null;
  group?: string | null;
  percent?: number | null;
  severity?: string | null;
  resets_at?: string | null;
  is_active?: boolean;
  scope?: {
    model?: {
      id?: string | null;
      display_name?: string | null;
    } | null;
    surface?: unknown;
  } | null;
}

export interface ScopedWeeklySnapshot {
  model_id: string | null;
  display_name: string;
  percent: number;
  resets_at: string | null;
}

export interface HistoryEntry {
  timestamp: number;         // ms since epoch (Date.now())
  five_hour: number | null;  // utilization % (0–100), null if bucket absent
  five_hour_resets_at?: string | null;
  seven_day: number | null;
  seven_day_resets_at?: string | null;
  scoped_weekly?: ScopedWeeklySnapshot[];
  extra_used: number | null; // extra usage spent, in minor currency units (e.g. cents)
  extra_limit: number | null; // extra usage monthly limit, in minor currency units
  extra_currency?: string | null; // ISO 4217 code, e.g. "EUR"
  extra_exponent?: number | null; // minor-unit exponent, e.g. 2 for cents
}
