import * as fs from "fs";
import * as path from "path";
import type { HistoryEntry } from "./types.js";

export interface HistoryDependencies {
  readFileSync: (filePath: string, encoding?: "utf8") => string;
  writeFileSync: (filePath: string, data: string, encoding?: "utf8") => void;
  now: () => number;
  getRetentionDays: () => number;
  log: (msg: string) => void;
}

/** Reads and parses the history JSON file. Returns an empty array on any error (missing file, corrupt JSON, I/O failure). */
export function readHistoryWithDependencies(filePath: string, deps: HistoryDependencies): HistoryEntry[] {
  try {
    const raw = deps.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

/** Appends an entry to the history file, pruning any entries older than the configured retention window. Write errors are logged and swallowed so a storage failure never breaks the extension. */
export function appendHistoryWithDependencies(filePath: string, entry: HistoryEntry, deps: HistoryDependencies): void {
  try {
    const existing = readHistoryWithDependencies(filePath, deps);
    const retentionMs = deps.getRetentionDays() * 86_400_000;
    const cutoff = deps.now() - retentionMs;
    const pruned = existing.filter((e) => e.timestamp >= cutoff);
    pruned.push(entry);
    deps.writeFileSync(filePath, JSON.stringify(pruned), "utf8");
  } catch (e) {
    deps.log(`history write error: ${String(e)}`);
  }
}

// ─── Concrete class using the real filesystem ─────────────────────────────────

export class HistoryStore {
  private readonly filePath: string;
  private readonly log: (msg: string) => void;

  /**
   * @param filePath Absolute path to usage-history.json (caller resolves vscode.Uri)
   * @param getRetentionDays Callback that returns the current retention setting (injected to avoid vscode import)
   */
  constructor(filePath: string, log: (msg: string) => void, getRetentionDays: () => number) {
    this.filePath = filePath;
    this.log = log;
    this._getRetentionDays = getRetentionDays;
  }

  private readonly _getRetentionDays: () => number;

  /** Builds the real-filesystem dependency bundle. `mkdirSync` here (not in the shared function) so unit tests can stub `writeFileSync` without hitting the filesystem. */
  private get deps(): HistoryDependencies {
    return {
      readFileSync: (p, enc) => fs.readFileSync(p, enc ?? "utf8"),
      writeFileSync: (p, d, enc) => {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, d, enc ?? "utf8");
      },
      now: () => Date.now(),
      getRetentionDays: this._getRetentionDays,
      log: this.log,
    };
  }

  read(): HistoryEntry[] {
    return readHistoryWithDependencies(this.filePath, this.deps);
  }

  append(entry: HistoryEntry): void {
    appendHistoryWithDependencies(this.filePath, entry, this.deps);
  }
}
