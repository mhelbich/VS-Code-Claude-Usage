export interface UsageBucket {
  utilization: number; // 0–100
  resets_at: string | null;
}

export interface ColorThresholds {
  warning: number; // utilization % for yellow
  danger: number; // utilization % for red
}

export interface UsageResponse {
  five_hour?: UsageBucket | null;
  seven_day?: UsageBucket | null;
  limits?: UsageLimit[] | null;
  extra_usage?: {
    is_enabled: boolean;
    monthly_limit: number;
    used_credits: number;
    utilization: number | null;
  };
}

export interface UsageLimit {
  kind?: string | null;
  percent?: number | null;
  resets_at?: string | null;
  is_active?: boolean;
  scope?: {
    model?: {
      id?: string | null;
      display_name?: string | null;
    } | null;
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
  extra_used: number | null; // raw credits used
  extra_limit: number | null; // raw credits limit (monthly)
}
