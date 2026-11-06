import * as path from "path";
import { canonicalDir, withAccountSuffix } from "./configDir";

/** An entry of the `claudeUsage.accounts` setting, as validated by parseAccountsSetting(). */
export interface AccountSetting {
  label?: string;
  configDir?: string;
}

/** An account the extension monitors: one status bar item pair, cache, history and forecast. */
export interface Account {
  /** Stable identity, derived from the config dir like the history file name. */
  key: string;
  /** Shown in the status bar and history panel; undefined for the implicit account without the setting. */
  label?: string;
  /** undefined means the default ~/.claude, as without CLAUDE_CONFIG_DIR. */
  configDir: string | undefined;
  /** Whether Claude launched from this window uses this account. */
  active: boolean;
}

/** Keeps the entries that are objects with string (or missing) `label` and `configDir`. */
export function parseAccountsSetting(raw: unknown): AccountSetting[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== "object") {
      return [];
    }
    const { label, configDir } = entry as Record<string, unknown>;
    if (label !== undefined && typeof label !== "string") {
      return [];
    }
    if (configDir !== undefined && typeof configDir !== "string") {
      return [];
    }
    return [{ label: label?.trim() || undefined, configDir }];
  });
}

function expandHome(dir: string, homedir: string, platform: NodeJS.Platform): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (dir === "~") {
    return homedir;
  }
  if (dir.startsWith("~/") || (platform === "win32" && dir.startsWith("~\\"))) {
    return pathApi.join(homedir, dir.slice(2));
  }
  return dir;
}

/**
 * Resolves the accounts to monitor. Without the setting, that's the one account Claude in this window
 * uses (`activeConfigDir`, resolved from claudeCode.environmentVariables). With it, the listed accounts
 * in order: `~` is expanded, relative dirs are skipped, and entries for the same dir are merged.
 */
export function resolveAccounts(
  entries: readonly AccountSetting[],
  activeConfigDir: string | undefined,
  homedir: string,
  platform: NodeJS.Platform = process.platform,
): { accounts: Account[]; warnings: string[] } {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  // keyOf() and the history/forecast names map ~/.claude to the bare name; this mirrors that for `active`.
  const defaultDir = canonicalDir([homedir, ".claude"], platform);
  const canonicalOrDefault = (dir: string | undefined) => (dir ? canonicalDir([dir], platform) : defaultDir);
  const activeDir = canonicalOrDefault(activeConfigDir);
  const keyOf = (dir: string | undefined) => withAccountSuffix("account", dir, homedir, platform);

  const implicit = (): Account[] => [{ key: keyOf(activeConfigDir), configDir: activeConfigDir, active: true }];
  if (entries.length === 0) {
    return { accounts: implicit(), warnings: [] };
  }

  const accounts: Account[] = [];
  const warnings: string[] = [];
  const labelsByKey = new Map<string, string>();
  for (const entry of entries) {
    const raw = entry.configDir?.trim() ?? "";
    const expanded = raw === "" ? undefined : expandHome(raw, homedir, platform).normalize("NFC");
    const label = entry.label ?? (expanded ? pathApi.basename(expanded) : ".claude");

    if (expanded !== undefined && !pathApi.isAbsolute(expanded)) {
      warnings.push(`Ignoring account "${label}": configDir "${raw}" is not an absolute path`);
      continue;
    }

    // An explicit ~/.claude keeps its path: the Keychain lookup then tries the suffixed entry Claude Code
    // writes when CLAUDE_CONFIG_DIR is set, then the default one; cache and history names stay the defaults.
    const configDir = expanded;
    const key = keyOf(configDir);
    const existing = labelsByKey.get(key);
    if (existing !== undefined) {
      warnings.push(`Ignoring account "${label}": it uses the same config dir as "${existing}"`);
      continue;
    }

    labelsByKey.set(key, label);
    accounts.push({ key, label, configDir, active: canonicalOrDefault(configDir) === activeDir });
  }
  if (accounts.length === 0) {
    warnings.push("No usable entries in claudeUsage.accounts — showing the account Claude Code uses in this window");
    return { accounts: implicit(), warnings };
  }
  return { accounts, warnings };
}

/** Which monitors to keep (updating label and active flag), create and dispose for a new account list. */
export function diffAccounts(currentKeys: Iterable<string>, next: readonly Account[]): { keep: Account[]; add: Account[]; remove: string[] } {
  const current = new Set(currentKeys);
  const nextKeys = new Set(next.map((account) => account.key));
  return {
    keep: next.filter((account) => current.has(account.key)),
    add: next.filter((account) => !current.has(account.key)),
    remove: [...current].filter((key) => !nextKeys.has(key)),
  };
}
