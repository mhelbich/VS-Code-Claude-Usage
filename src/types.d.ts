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
  seven_day_opus?: UsageBucket | null;
  extra_usage?: {
    is_enabled: boolean;
    monthly_limit: number;
    used_credits: number;
    utilization: number | null;
  };
}

export interface HistoryEntry {
  timestamp: number;         // ms since epoch (Date.now())
  five_hour: number | null;  // utilization % (0–100), null if bucket absent
  seven_day: number | null;
  seven_day_opus: number | null;
  extra_used: number | null; // raw credits used
  extra_limit: number | null; // raw credits limit (monthly)
}
