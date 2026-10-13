import { createHash } from "crypto";
import * as os from "os";
import * as path from "path";

/**
 * Suffixes a name with a short hash of the config dir, the scheme Claude Code uses for its
 * Keychain entries, so per-account data stays apart. The default config dir keeps the bare name.
 */
export function withConfigDirSuffix(name: string, configDir: string | undefined): string {
  if (!configDir) {
    return name;
  }

  const suffix = createHash("sha256").update(configDir.normalize("NFC")).digest("hex").slice(0, 8);
  return `${name}-${suffix}`;
}

/**
 * Names this extension's per-account storage (usage history, forecast profile) after the config dir.
 * Unlike the Keychain names, a config dir that resolves to the default ~/.claude keeps the bare name,
 * so setting CLAUDE_CONFIG_DIR to the default dir explicitly doesn't start a new history.
 */
export function withAccountSuffix(name: string, configDir: string | undefined, homedir = os.homedir()): string {
  if (!configDir || path.resolve(configDir) === path.resolve(homedir, ".claude")) {
    return name;
  }

  return withConfigDirSuffix(name, configDir);
}

/**
 * Resolves which directory Claude Code's own credential store follows.
 * CLAUDE_SECURESTORAGE_CONFIG_DIR overrides CLAUDE_CONFIG_DIR for this purpose when set —
 * including when set to an empty string, which pins the default store even if
 * CLAUDE_CONFIG_DIR points elsewhere. See https://github.com/anthropics/claude-code/issues/79223.
 * An empty CLAUDE_CONFIG_DIR means the default dir. The Claude CLI itself would resolve it relative
 * to its working directory, which no setup relies on deliberately.
 * The result is NFC-normalized, as the CLI does for its config dir.
 */
export function resolveCredentialsConfigDir(env: {
  CLAUDE_SECURESTORAGE_CONFIG_DIR?: string;
  CLAUDE_CONFIG_DIR?: string;
}): string | undefined {
  const configDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR !== undefined ? env.CLAUDE_SECURESTORAGE_CONFIG_DIR : env.CLAUDE_CONFIG_DIR;
  return configDir ? configDir.normalize("NFC") : undefined;
}

/**
 * An entry of the Claude Code extension's `claudeCode.environmentVariables` setting.
 */
export interface ClaudeCodeEnvironmentVariable {
  name: string;
  value: string;
}

/**
 * Normalizes the raw `claudeCode.environmentVariables` value the way the Claude Code extension
 * does: entries without a string name are dropped, values are stringified (null becomes ""), and
 * the legacy object form `{ NAME: value }` is accepted too.
 */
export function parseClaudeCodeEnvironmentVariables(raw: unknown): ClaudeCodeEnvironmentVariable[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is { name: string; value?: unknown } => entry !== null && typeof entry === "object" && typeof entry.name === "string")
      .map((entry) => ({ name: entry.name, value: entry.value == null ? "" : String(entry.value) }));
  }
  if (raw !== null && typeof raw === "object") {
    return Object.entries(raw).map(([name, value]) => ({ name, value: value == null ? "" : String(value) }));
  }
  return [];
}

// The Claude Code extension only takes CLAUDE_CONFIG_DIR from the setting when it is absolute. With a
// process wrapper it checks it as a Windows path; otherwise as a local path, where Windows also needs
// a drive letter or UNC prefix (so a rooted path like "\claude" is rejected).
function isAbsoluteConfigDir(value: string, platform: NodeJS.Platform, processWrapper: boolean): boolean {
  if (processWrapper) {
    return path.win32.isAbsolute(value);
  }
  if (platform === "win32") {
    return /^([A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/])/.test(value);
  }
  return path.posix.isAbsolute(value);
}

/**
 * Layers the Claude Code extension's `claudeCode.environmentVariables` setting over the process
 * environment, as that extension does when it launches Claude in its panel. VS Code has no
 * per-profile process environment, so this setting is how a profile points Claude at its own config dir.
 *
 * Mirrors Claude Code 2.1.296: entries override the environment in order, except CLAUDE_CONFIG_DIR,
 * which only applies when absolute (the last absolute entry wins) and otherwise leaves the
 * environment's value in place. Windows variable names are case-insensitive, so there they are
 * uppercased, letting the setting win over any casing.
 *
 * Not covered: Claude launched in a terminal (`claudeCode.useTerminal`) inherits the shell's
 * environment, which the extension host can't see.
 */
export function applyClaudeCodeEnvironment(
  env: Record<string, string | undefined>,
  variables: readonly ClaudeCodeEnvironmentVariable[],
  platform: NodeJS.Platform = process.platform,
  processWrapper = false,
): Record<string, string | undefined> {
  const normalizeName = (name: string) => (platform === "win32" ? name.toUpperCase() : name);
  const result = Object.fromEntries(Object.entries(env).map(([name, value]) => [normalizeName(name), value]));

  let configDir: string | undefined;
  for (const { name, value } of variables) {
    if (normalizeName(name) === "CLAUDE_CONFIG_DIR") {
      if (isAbsoluteConfigDir(value, platform, processWrapper)) {
        configDir = value;
      }
    } else if (name) {
      result[normalizeName(name)] = value;
    }
  }

  if (configDir !== undefined) {
    result.CLAUDE_CONFIG_DIR = configDir;
  }
  return result;
}
