import test from "node:test";
import assert from "node:assert/strict";

import { HistoryDependencies, readHistoryWithDependencies, appendHistoryWithDependencies } from "../history.js";
import type { HistoryEntry } from "../types.js";

const sample: HistoryEntry = {
  timestamp: 1_000_000,
  five_hour: 42,
  seven_day: 10,
  seven_day_opus: 5,
  extra_used: 20,
  extra_limit: 500,
};

function makeDeps(overrides: Partial<HistoryDependencies> = {}): HistoryDependencies {
  return {
    readFileSync: () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    writeFileSync: () => {},
    now: () => 2_000_000,
    getRetentionDays: () => 30,
    log: () => {},
    ...overrides,
  };
}

// ─── readHistoryWithDependencies ───────────────────────────────────────────────

test("read returns empty array when file is missing", () => {
  const deps = makeDeps();
  assert.deepEqual(readHistoryWithDependencies("/store/history.json", deps), []);
});

test("read returns parsed entries from file", () => {
  const deps = makeDeps({ readFileSync: () => JSON.stringify([sample]) });
  assert.deepEqual(readHistoryWithDependencies("/store/history.json", deps), [sample]);
});

test("read returns empty array and does not throw on corrupt JSON", () => {
  const deps = makeDeps({ readFileSync: () => "{not-json" });
  assert.deepEqual(readHistoryWithDependencies("/store/history.json", deps), []);
});

test("read returns empty array on arbitrary I/O error", () => {
  const deps = makeDeps({
    readFileSync: () => {
      throw new Error("EACCES");
    },
  });
  assert.deepEqual(readHistoryWithDependencies("/store/history.json", deps), []);
});

// ─── appendHistoryWithDependencies ────────────────────────────────────────────

test("append writes the new entry to disk", () => {
  let written: string | undefined;
  const deps = makeDeps({
    readFileSync: () => "[]",
    writeFileSync: (_, data) => {
      written = data;
    },
    now: () => 9_000_000,
  });

  appendHistoryWithDependencies("/store/history.json", sample, deps);

  const parsed = JSON.parse(written!) as HistoryEntry[];
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], sample);
});

test("append preserves existing entries", () => {
  const existing: HistoryEntry = { ...sample, timestamp: 100 };
  let written: string | undefined;
  const deps = makeDeps({
    readFileSync: () => JSON.stringify([existing]),
    writeFileSync: (_, data) => {
      written = data;
    },
  });

  appendHistoryWithDependencies("/store/history.json", sample, deps);

  const parsed = JSON.parse(written!) as HistoryEntry[];
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], existing);
  assert.deepEqual(parsed[1], sample);
});

test("append prunes entries older than retentionDays", () => {
  const oneDayMs = 86_400_000;
  const now = 50 * oneDayMs;
  const old: HistoryEntry = { ...sample, timestamp: 1 };
  const recent: HistoryEntry = { ...sample, timestamp: now - 5 * oneDayMs };
  let written: string | undefined;

  const deps = makeDeps({
    readFileSync: () => JSON.stringify([old, recent]),
    writeFileSync: (_, data) => {
      written = data;
    },
    now: () => now,
    getRetentionDays: () => 30,
  });

  appendHistoryWithDependencies("/store/history.json", { ...sample, timestamp: now }, deps);

  const parsed = JSON.parse(written!) as HistoryEntry[];
  assert.ok(!parsed.some((e) => e.timestamp === old.timestamp), "old entry must be pruned");
  assert.ok(
    parsed.some((e) => e.timestamp === recent.timestamp),
    "recent entry must be kept",
  );
});

test("append does not throw on write error", () => {
  const deps = makeDeps({
    readFileSync: () => "[]",
    writeFileSync: () => {
      throw new Error("EACCES");
    },
  });
  assert.doesNotThrow(() => appendHistoryWithDependencies("/store/history.json", sample, deps));
});

test("append creates file when it does not exist", () => {
  let written: string | undefined;
  const deps = makeDeps({
    writeFileSync: (_, data) => {
      written = data;
    },
  });

  appendHistoryWithDependencies("/store/history.json", sample, deps);

  const parsed = JSON.parse(written!) as HistoryEntry[];
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], sample);
});
