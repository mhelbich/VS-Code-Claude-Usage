import { execSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Interface for Claude credentials, representing the structure of the data that can be stored in the Keychain or the .credentials.json file.
 */
export type ClaudeCredentials = {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType: string | null;
    rateLimitTier: string | null;
  };
  organizationUuid?: string;
};

export interface CredentialDependencies {
  platform: NodeJS.Platform;
  configDir?: string;
  homedir: () => string;
  joinPath: (...paths: string[]) => string;
  execSync: (command: string, options: { stdio: ["pipe", "pipe", "pipe"] }) => string | Buffer;
  readFileSync: (path: string, encoding: "utf8") => string;
  now: () => number;
}

const KEYCHAIN_SERVICE = "Claude Code-credentials";

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

// With CLAUDE_CONFIG_DIR set, Claude Code refreshes only the suffixed entry; the base one goes stale.
export function getKeychainServiceNames(configDir: string | undefined): string[] {
  if (!configDir) {
    return [KEYCHAIN_SERVICE];
  }

  return [withConfigDirSuffix(KEYCHAIN_SERVICE, configDir), KEYCHAIN_SERVICE];
}

export function parseClaudeCredentials(raw: string): ClaudeCredentials {
  return JSON.parse(raw) as ClaudeCredentials;
}

export function getCredentialFilePath(configDir: string | undefined, homedir: string, joinPath: (...paths: string[]) => string): string {
  return configDir ? joinPath(configDir, ".credentials.json") : joinPath(homedir, ".claude", ".credentials.json");
}

export function getAccessTokenFromCredentials(creds: ClaudeCredentials, now = Date.now()): string | null {
  const oauth = creds.claudeAiOauth;
  if (!oauth?.accessToken) {
    return null;
  }

  if (oauth.expiresAt && oauth.expiresAt < now) {
    return null;
  }

  return oauth.accessToken;
}

function getAccessTokenFromRaw(raw: string, now: number): string | null {
  return getAccessTokenFromCredentials(parseClaudeCredentials(raw), now);
}

/**
 * Resolves which directory Claude Code's own credential store follows.
 * CLAUDE_SECURESTORAGE_CONFIG_DIR overrides CLAUDE_CONFIG_DIR for this purpose when set —
 * including when set to an empty string, which pins the default store even if
 * CLAUDE_CONFIG_DIR points elsewhere. See https://github.com/anthropics/claude-code/issues/79223.
 * An empty CLAUDE_CONFIG_DIR means the default dir, not a path relative to the working directory.
 */
export function resolveCredentialsConfigDir(env: {
  CLAUDE_SECURESTORAGE_CONFIG_DIR?: string;
  CLAUDE_CONFIG_DIR?: string;
}): string | undefined {
  if (env.CLAUDE_SECURESTORAGE_CONFIG_DIR !== undefined) {
    return env.CLAUDE_SECURESTORAGE_CONFIG_DIR || undefined;
  }

  return env.CLAUDE_CONFIG_DIR || undefined;
}

/**
 * An entry of the Claude Code extension's `claudeCode.environmentVariables` setting.
 */
export interface ClaudeCodeEnvironmentVariable {
  name: string;
  value: string;
}

/**
 * Layers the Claude Code extension's `claudeCode.environmentVariables` setting over the process
 * environment, as that extension does when it launches Claude. VS Code has no per-profile process
 * environment, so this setting is how a profile points Claude at its own config dir.
 * Malformed entries are skipped, since the setting belongs to another extension. Windows variable
 * names are case-insensitive, so there they are uppercased, letting the setting win over any casing.
 */
export function applyClaudeCodeEnvironment(
  env: Record<string, string | undefined>,
  variables: readonly ClaudeCodeEnvironmentVariable[] | undefined,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  const overrides = (variables ?? []).filter((variable) => typeof variable?.name === "string" && typeof variable.value === "string");
  const entries = [...Object.entries(env), ...overrides.map(({ name, value }) => [name, value] as const)];
  return Object.fromEntries(platform === "win32" ? entries.map(([name, value]) => [name.toUpperCase(), value]) : entries);
}

export function getAccessTokenWithDependencies(deps: CredentialDependencies): string | null {
  // macOS: read from Keychain
  if (deps.platform === "darwin") {
    for (const service of getKeychainServiceNames(deps.configDir)) {
      try {
        const raw = deps.execSync(`security find-generic-password -s "${service}" -w`, {
          stdio: ["pipe", "pipe", "pipe"],
        })
          .toString()
          .trim();

        const token = getAccessTokenFromRaw(raw, deps.now());
        if (token) {
          return token;
        }
      } catch {}
    }
  }

  // Linux / Windows (WSL) / macOS fallback: read ~/.claude/.credentials.json
  const credFile = getCredentialFilePath(deps.configDir, deps.homedir(), deps.joinPath);

  try {
    const raw = deps.readFileSync(credFile, "utf8");
    return getAccessTokenFromRaw(raw, deps.now());
  } catch {
    return null;
  }
}

/**
 * Looks up the Claude access token, first trying to read from the macOS Keychain (if on macOS), and then falling back to reading from a .credentials.json file in the user's home directory (or the given config dir, resolved from the CLAUDE_CONFIG_DIR / CLAUDE_SECURESTORAGE_CONFIG_DIR environment variables). Returns the access token if found and valid, or null if not found or expired.
 * This function abstracts away the platform-specific details of how credentials are stored and accessed, providing a simple interface for the rest of the extension to retrieve the necessary token for API calls.
 */
export function getAccessToken(configDir: string | undefined): string | null {
  return getAccessTokenWithDependencies({
    platform: process.platform,
    configDir,
    homedir: () => os.homedir(),
    joinPath: path.join,
    execSync,
    readFileSync: fs.readFileSync,
    now: () => Date.now(),
  });
}
