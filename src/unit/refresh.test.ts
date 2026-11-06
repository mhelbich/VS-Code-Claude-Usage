import test from "node:test";
import assert from "node:assert/strict";

import type { CacheEntry } from "../cache";
import { EMPTY_FORECAST_PROFILE, type ForecastProfile } from "../forecast";
import { refreshUsage, type RefreshDependencies } from "../refresh";
import type { Action } from "../statusBar";
import type { HistoryEntry, UsageResponse } from "../types";

const NOW = Date.parse("2026-10-12T10:00:00Z");

function usage(utilization: number): UsageResponse {
  return {
    five_hour: { utilization, resets_at: "2026-10-12T12:00:00Z" },
    seven_day: { utilization, resets_at: "2026-10-16T02:00:00Z" },
  } as UsageResponse;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A fake extension around refreshUsage. Each account (config dir) has its own token, cache and history.
 * Fetches and forecast profile saves stay pending until the test settles them, so a config dir change
 * can be placed exactly between a refresh's steps.
 */
function harness(accounts: Record<string, { token: string | null; cache?: CacheEntry }>) {
  let configDir: string | undefined = "/home/test/.claude-a";
  const fetches: Array<Deferred<UsageResponse> & { token: string }> = [];
  const saves: Array<Deferred<void>> = [];
  const actions: Action[] = [];
  const shown: Array<{ configDir: string | undefined; usage: UsageResponse }> = [];
  const history: Record<string, HistoryEntry[]> = {};
  const caches: Record<string, UsageResponse> = {};
  let profile: ForecastProfile = EMPTY_FORECAST_PROFILE;

  const deps: RefreshDependencies = {
    getConfigDir: () => configDir,
    readCache: (dir) => accounts[dir ?? ""]?.cache ?? null,
    writeCache: (data, dir) => {
      caches[dir ?? ""] = data;
    },
    getAccessToken: (dir) => accounts[dir ?? ""]?.token ?? null,
    fetchUsage: (token) => {
      const fetch = Object.assign(deferred<UsageResponse>(), { token });
      fetches.push(fetch);
      return fetch.promise;
    },
    getForecastProfile: () => profile,
    saveForecastProfile: (next) => {
      profile = next;
      const save = deferred<void>();
      saves.push(save);
      return save.promise;
    },
    appendHistory: (entry) => {
      (history[configDir ?? ""] ??= []).push(entry);
    },
    showUsage: (data, forecast) => {
      shown.push({ configDir, usage: data });
      actions.push({ type: "fetch-success", usage: data, forecast, thresholds: { warning: 70, danger: 90 } });
    },
    dispatch: (action) => actions.push(action),
    getRefreshIntervalSeconds: () => 150,
    onIncompleteForecastWeek: () => {},
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    now: () => NOW,
  };

  return {
    deps,
    fetches,
    saves,
    actions,
    shown,
    history,
    caches,
    switchTo: (dir: string | undefined) => {
      configDir = dir;
    },
    lastAction: () => actions[actions.length - 1],
  };
}

// Lets pending promise continuations run, so a refresh advances to its next await.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// A refresh that skips a stale check moves on to a step the test never settles; time out instead of hanging.
const timeout = { timeout: 2_000 };

const A = "/home/test/.claude-a";
const B = "/home/test/.claude-b";

test("refreshUsage shows a fresh cache entry without fetching", timeout, async () => {
  const h = harness({ [A]: { token: "token-a", cache: { fetchedAt: NOW - 10_000, data: usage(10) } } });

  const done = refreshUsage(h.deps);
  await settle();
  h.saves[0].resolve();
  await done;

  assert.equal(h.fetches.length, 0);
  assert.deepEqual(h.shown, [{ configDir: A, usage: usage(10) }]);
});

test("refreshUsage fetches, caches and records history for the current config dir", timeout, async () => {
  const h = harness({ [A]: { token: "token-a" } });

  const done = refreshUsage(h.deps);
  h.fetches[0].resolve(usage(20));
  await settle();
  h.saves[0].resolve();
  await done;

  assert.equal(h.fetches[0].token, "token-a");
  assert.deepEqual(h.caches[A], usage(20));
  assert.equal(h.history[A]?.length, 1);
  assert.deepEqual(h.shown, [{ configDir: A, usage: usage(20) }]);
});

test("refreshUsage reports no-token when the config dir has no credentials", timeout, async () => {
  const h = harness({ [A]: { token: null } });

  await refreshUsage(h.deps);

  assert.equal(h.fetches.length, 0);
  assert.deepEqual(h.lastAction(), { type: "no-token" });
});

test("refreshUsage discards a fetch that finishes after the config dir changed", timeout, async () => {
  const h = harness({ [A]: { token: "token-a" }, [B]: { token: "token-b" } });

  const done = refreshUsage(h.deps);
  h.switchTo(B);
  h.fetches[0].resolve(usage(30));
  await done;

  assert.equal(h.caches[A], undefined);
  assert.equal(h.caches[B], undefined);
  assert.deepEqual(h.history, {});
  assert.deepEqual(h.shown, []);
});

test("refreshUsage keeps the history entry with its own account when the config dir changes during the forecast save", timeout, async () => {
  const h = harness({ [A]: { token: "token-a" }, [B]: { token: "token-b" } });

  const done = refreshUsage(h.deps);
  h.fetches[0].resolve(usage(40));
  await settle();
  h.switchTo(B);
  h.saves[0].resolve();
  await done;

  assert.equal(h.history[A]?.length, 1);
  assert.equal(h.history[B], undefined);
  assert.deepEqual(h.shown, []);
});

test("refreshUsage discards a cache hit when the config dir changes during the forecast save", timeout, async () => {
  const h = harness({ [A]: { token: "token-a", cache: { fetchedAt: NOW - 10_000, data: usage(50) } } });

  const done = refreshUsage(h.deps);
  await settle();
  h.switchTo(B);
  h.saves[0].resolve();
  await done;

  assert.deepEqual(h.shown, []);
});

test("refreshUsage doesn't report an error for a fetch that fails after the config dir changed", timeout, async () => {
  const h = harness({ [A]: { token: "token-a" } });

  const done = refreshUsage(h.deps);
  h.switchTo(B);
  h.fetches[0].reject(new Error("network down"));
  await done;

  assert.equal(
    h.actions.some((action) => action.type === "fetch-error"),
    false,
  );
});

test("a refresh for the previous account can't overwrite the new account's no-token state", timeout, async () => {
  const h = harness({ [A]: { token: "token-a" }, [B]: { token: null } });

  const first = refreshUsage(h.deps);
  h.switchTo(B);
  await refreshUsage(h.deps, true);
  assert.deepEqual(h.lastAction(), { type: "no-token" });

  h.fetches[0].resolve(usage(60));
  await settle();
  h.saves[0]?.resolve();
  await first;

  assert.deepEqual(h.lastAction(), { type: "no-token" });
  assert.deepEqual(h.shown, []);
});

test("a refresh for the previous account can't overwrite the new account's usage", timeout, async () => {
  const h = harness({ [A]: { token: "token-a" }, [B]: { token: "token-b" } });

  const first = refreshUsage(h.deps);
  h.switchTo(B);
  const second = refreshUsage(h.deps, true);

  // The new account's fetch finishes first, the previous account's afterwards.
  h.fetches[1].resolve(usage(70));
  await settle();
  h.saves[0].resolve();
  await second;
  h.fetches[0].resolve(usage(80));
  await first;

  assert.deepEqual(h.shown, [{ configDir: B, usage: usage(70) }]);
  assert.deepEqual(h.caches, { [B]: usage(70) });
});
