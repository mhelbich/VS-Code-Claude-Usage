import test from "node:test";
import assert from "node:assert/strict";

import { fetchUsage } from "../api";
import { UsageResponse } from "../types";

test("fetchUsage calls the Anthropic usage endpoint with the expected headers", async () => {
  const originalFetch = globalThis.fetch;
  type FetchInput = Parameters<typeof fetch>[0];
  type FetchInit = Parameters<typeof fetch>[1];
  const calls: Array<{ input: FetchInput; init?: FetchInit }> = [];

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    calls.push({ input, init });
    return {
      ok: true,
      json: async () => ({} satisfies UsageResponse),
    } as Response;
  }) as typeof fetch;

  try {
    await fetchUsage("test-token");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "https://api.anthropic.com/api/oauth/usage");
  assert.deepEqual(calls[0]?.init, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "claude-code/2.0.32",
      Authorization: "Bearer test-token",
      "anthropic-beta": "oauth-2025-04-20",
    },
  });
});

test("fetchUsage returns parsed usage data when the response is ok", async () => {
  const originalFetch = globalThis.fetch;
  const expected: UsageResponse = {
    five_hour: { utilization: 20, resets_at: "2026-03-16T12:00:00.000Z" },
    seven_day: { utilization: 55, resets_at: "2026-03-20T12:00:00.000Z" },
  };

  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => expected,
    }) as Response) as typeof fetch;

  try {
    const result = await fetchUsage("test-token");
    assert.deepEqual(result, expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchUsage returns null when the response is not ok", async () => {
  const originalFetch = globalThis.fetch;
  let jsonCalled = false;

  globalThis.fetch = (async () =>
    ({
      ok: false,
      json: async () => {
        jsonCalled = true;
        return {};
      },
    }) as Response) as typeof fetch;

  try {
    const result = await fetchUsage("test-token");

    assert.equal(result, null);
    assert.equal(jsonCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
