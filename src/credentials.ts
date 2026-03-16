import { execSync } from "child_process";
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

export function getAccessTokenWithDependencies(deps: CredentialDependencies): string | null {
  // macOS: read from Keychain
  if (deps.platform === "darwin") {
    try {
      const raw = deps.execSync('security find-generic-password -s "Claude Code-credentials" -w', {
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();

      const token = getAccessTokenFromRaw(raw, deps.now());
      if (token) {
        return token;
      }
    } catch {
      // fall through to file-based fallback
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
 * Looks up the Claude access token, first trying to read from the macOS Keychain (if on macOS), and then falling back to reading from a .credentials.json file in the user's home directory (or a custom path defined by the CLAUDE_CONFIG_DIR environment variable). Returns the access token if found and valid, or null if not found or expired.
 * This function abstracts away the platform-specific details of how credentials are stored and accessed, providing a simple interface for the rest of the extension to retrieve the necessary token for API calls.
 */
export function getAccessToken(): string | null {
  return getAccessTokenWithDependencies({
    platform: process.platform,
    configDir: process.env.CLAUDE_CONFIG_DIR,
    homedir: () => os.homedir(),
    joinPath: path.join,
    execSync,
    readFileSync: fs.readFileSync,
    now: () => Date.now(),
  });
}
