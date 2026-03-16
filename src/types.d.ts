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
