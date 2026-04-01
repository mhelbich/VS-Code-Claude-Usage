import test from "node:test";
import assert from "node:assert/strict";

import { CacheDependencies, CacheEntry, FRESHNESS_TOLERANCE_MS, getCacheFilePath, isCacheFresh, readCacheWithDependencies, writeCacheWithDependencies } from "../cache";
import type { UsageResponse } from "../types";

const sampleUsage: UsageResponse = {
  five_hour: { utilization: 42, resets_at: "2025-01-01T00:00:00Z" },
  seven_day: { utilization: 10, resets_at: null },
};

// ─── getCacheFilePath ─────────────────────────────────────────────────────────

test("getCacheFilePath prefers configured Claude config dir", () => {
  assert.equal(
    getCacheFilePath("/custom/claude", "/home/test", (...parts) => parts.join("/")),
    "/custom/claude/usage-cache.json",
  );
});

test("getCacheFilePath falls back to ~/.claude/usage-cache.json", () => {
  assert.equal(
    getCacheFilePath(undefined, "/home/test", (...parts) => parts.join("/")),
    "/home/test/.claude/usage-cache.json",
  );
});

// ─── isCacheFresh ─────────────────────────────────────────────────────────────

test("isCacheFresh returns true when entry is within the interval", () => {
  const entry: CacheEntry = { fetchedAt: 1_000, data: sampleUsage };
  // fetched at t=1000, interval=120s → fresh until t=121000; checking at t=60000
  assert.equal(isCacheFresh(entry, 120, 61_000), true);
});

test("isCacheFresh returns false when entry is older than the interval", () => {
  const entry: CacheEntry = { fetchedAt: 1_000, data: sampleUsage };
  // fetched at t=1000, interval=120s → stale after t=121000; checking at t=200000
  assert.equal(isCacheFresh(entry, 120, 200_000), false);
});

test("isCacheFresh returns false when entry age exactly equals the interval", () => {
  const entry: CacheEntry = { fetchedAt: 1_000, data: sampleUsage };
  // boundary: now - fetchedAt === intervalSeconds * 1000 → older than interval - TOLERANCE
  assert.equal(isCacheFresh(entry, 120, 121_000), false);
});

test("isCacheFresh returns true when entry age is just under interval minus tolerance", () => {
  const entry: CacheEntry = { fetchedAt: 1_000, data: sampleUsage };
  // interval=120s, tolerance=2s → threshold = 118 000 ms; checking at t = 118 999 (age 117 999 ms)
  assert.equal(isCacheFresh(entry, 120, 1_000 + 120_000 - FRESHNESS_TOLERANCE_MS - 1), true);
});

test("isCacheFresh returns false when entry age equals interval minus tolerance", () => {
  const entry: CacheEntry = { fetchedAt: 1_000, data: sampleUsage };
  // age exactly at the tolerance boundary → stale
  assert.equal(isCacheFresh(entry, 120, 1_000 + 120_000 - FRESHNESS_TOLERANCE_MS), false);
});

test("isCacheFresh treats cache as stale when timer tick fires a few ms before refreshStartedAt", () => {
  // Regression: setInterval fires at a scheduled tick; Date.now() inside refresh() is captured
  // epsilon ms LATER, so fetchedAt = tickTime + epsilon. The *next* tick fires at
  // tickTime + interval, making the cache age (interval - epsilon) ms — strictly less than
  // interval — which previously caused isCacheFresh to return true and skip the fetch.
  // The FRESHNESS_TOLERANCE_MS buffer ensures the cache is treated as stale in this case.
  const intervalSeconds = 150;
  const tickTime = 0;
  const epsilon = 3; // ms between tick firing and Date.now() inside refresh()

  const entry: CacheEntry = { fetchedAt: tickTime + epsilon, data: sampleUsage };
  const nextTickTime = tickTime + intervalSeconds * 1_000;

  // Without the tolerance this would return true (cache appears fresh) → fetch skipped.
  // With the tolerance the cache is correctly treated as stale → fetch proceeds.
  assert.equal(isCacheFresh(entry, intervalSeconds, nextTickTime), false);
});

// ─── readCacheWithDependencies ────────────────────────────────────────────────

function makeDeps(overrides: Partial<CacheDependencies> = {}): CacheDependencies {
  return {
    configDir: "/claude",
    homedir: () => "/home/test",
    joinPath: (...parts) => parts.join("/"),
    readFileSync: () => {
      throw new Error("readFileSync not configured");
    },
    writeFileSync: () => {
      throw new Error("writeFileSync not configured");
    },
    now: () => 1_000,
    ...overrides,
  };
}

test("readCacheWithDependencies returns parsed cache entry", () => {
  const entry: CacheEntry = { fetchedAt: 500, data: sampleUsage };
  const deps = makeDeps({ readFileSync: () => JSON.stringify(entry) });

  assert.deepEqual(readCacheWithDependencies(deps), entry);
});

test("readCacheWithDependencies reads from the correct path", () => {
  let readPath: string | undefined;
  const entry: CacheEntry = { fetchedAt: 500, data: sampleUsage };
  const deps = makeDeps({
    configDir: "/custom/claude",
    readFileSync: (p) => {
      readPath = p;
      return JSON.stringify(entry);
    },
  });

  readCacheWithDependencies(deps);
  assert.equal(readPath, "/custom/claude/usage-cache.json");
});

test("readCacheWithDependencies returns null when the file is missing", () => {
  const deps = makeDeps({
    readFileSync: () => {
      throw new Error("ENOENT");
    },
  });

  assert.equal(readCacheWithDependencies(deps), null);
});

test("readCacheWithDependencies returns null when the file contains invalid JSON", () => {
  const deps = makeDeps({ readFileSync: () => "{not-json" });

  assert.equal(readCacheWithDependencies(deps), null);
});

// ─── writeCacheWithDependencies ───────────────────────────────────────────────

test("writeCacheWithDependencies writes a CacheEntry with the current timestamp", () => {
  let writtenPath: string | undefined;
  let writtenContent: string | undefined;

  const deps = makeDeps({
    now: () => 9_000,
    writeFileSync: (p, data) => {
      writtenPath = p;
      writtenContent = data;
    },
  });

  writeCacheWithDependencies(sampleUsage, deps);

  assert.equal(writtenPath, "/claude/usage-cache.json");
  const parsed = JSON.parse(writtenContent!) as CacheEntry;
  assert.equal(parsed.fetchedAt, 9_000);
  assert.deepEqual(parsed.data, sampleUsage);
});

test("writeCacheWithDependencies uses explicit fetchedAt when provided", () => {
  let writtenContent: string | undefined;
  const deps = makeDeps({
    now: () => 9_000,
    writeFileSync: (_, data) => {
      writtenContent = data;
    },
  });

  writeCacheWithDependencies(sampleUsage, deps, 1_000);

  const parsed = JSON.parse(writtenContent!) as CacheEntry;
  assert.equal(parsed.fetchedAt, 1_000);
});

test("writeCacheWithDependencies writes to the correct path", () => {
  let writtenPath: string | undefined;
  const deps = makeDeps({
    configDir: undefined,
    homedir: () => "/home/alice",
    writeFileSync: (p) => {
      writtenPath = p;
    },
  });

  writeCacheWithDependencies(sampleUsage, deps);
  assert.equal(writtenPath, "/home/alice/.claude/usage-cache.json");
});

test("writeCacheWithDependencies silently ignores write errors", () => {
  const deps = makeDeps({
    writeFileSync: () => {
      throw new Error("EACCES");
    },
  });

  // should not throw
  assert.doesNotThrow(() => writeCacheWithDependencies(sampleUsage, deps));
});
