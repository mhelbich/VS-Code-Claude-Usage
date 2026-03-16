import type { UsageResponse } from "./types";

export async function fetchUsage(token: string): Promise<UsageResponse | null> {
  const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "claude-code/2.0.32",
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
  });

  if (!resp.ok) {
    return null;
  }

  return resp.json() as Promise<UsageResponse>;
}
