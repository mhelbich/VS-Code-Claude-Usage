import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { UsageResponse } from "./types";

/**
 * A cached API response paired with the timestamp at which it was fetched.
 * Written to disk so that multiple VS Code windows can share a single result
 * and avoid redundant API calls.
 */
export interface CacheEntry {
  fetchedAt: number;
  data: UsageResponse;
}

/**
 * Dependencies required by the cache read/write functions.
 * Expressed as an interface so that tests can inject in-memory stubs instead
 * of touching the real filesystem.
 */
export interface CacheDependencies {
  configDir?: string;
  homedir: () => string;
  joinPath: (...paths: string[]) => string;
  readFileSync: (filePath: string, encoding: "utf8") => string;
  writeFileSync: (filePath: string, data: string, encoding: "utf8") => void;
  now: () => number;
}

/**
 * Returns the path to the shared cache file, respecting the CLAUDE_CONFIG_DIR
 * environment variable (the same override used by the credentials file).
 */
export function getCacheFilePath(configDir: string | undefined, homedir: string, joinPath: (...paths: string[]) => string): string {
  const dir = configDir ?? joinPath(homedir, ".claude");
  return joinPath(dir, "usage-cache.json");
}

/**
 * Reads the shared cache file and returns its parsed contents, or null if the
 * file is missing, unreadable, or contains invalid JSON.
 */
export function readCacheWithDependencies(deps: CacheDependencies): CacheEntry | null {
  try {
    const cachePath = getCacheFilePath(deps.configDir, deps.homedir(), deps.joinPath);
    const raw = deps.readFileSync(cachePath, "utf8");
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

/**
 * Writes a usage response to the shared cache file, recording the current
 * timestamp so that freshness can be checked later. Errors are silently ignored
 * because the cache is purely a performance optimisation — a missing cache only
 * results in an extra API call, never in broken behaviour.
 */
export function writeCacheWithDependencies(data: UsageResponse, deps: CacheDependencies, fetchedAt?: number): void {
  try {
    const cachePath = getCacheFilePath(deps.configDir, deps.homedir(), deps.joinPath);
    const entry: CacheEntry = { fetchedAt: fetchedAt ?? deps.now(), data };
    deps.writeFileSync(cachePath, JSON.stringify(entry), "utf8");
  } catch {
    // ignore — cache is best-effort
  }
}

/**
 * Returns true when the cache entry is younger than the configured refresh
 * interval, meaning the cached data is still considered current and no API
 * call is needed. Accepts an optional `now` argument so tests can control time.
 */
export function isCacheFresh(entry: CacheEntry, intervalSeconds: number, now = Date.now()): boolean {
  return now - entry.fetchedAt < intervalSeconds * 1000;
}

// ─── Simple public API (uses the real filesystem) ────────────────────────────

const realDeps: CacheDependencies = {
  configDir: process.env.CLAUDE_CONFIG_DIR,
  homedir: () => os.homedir(),
  joinPath: path.join,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  now: () => Date.now(),
};

export function readCache(): CacheEntry | null {
  return readCacheWithDependencies(realDeps);
}

export function writeCache(data: UsageResponse, fetchedAt?: number): void {
  writeCacheWithDependencies(data, realDeps, fetchedAt);
}
