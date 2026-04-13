import type { UsageResponse } from "./types";

/**
 * Fetches usage data from the Anthropic API using the provided token.
 * @param token - The access token to authenticate the API request.
 * @returns A promise that resolves to the usage data response from the API.
 * @throws An error if the HTTP response is not ok, including the status code, status text, and response body for debugging.
 */
export async function fetchUsage(token: string): Promise<UsageResponse> {
  const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "claude-code/2.1.104",
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${body}`);
  }

  return resp.json() as Promise<UsageResponse>;
}
