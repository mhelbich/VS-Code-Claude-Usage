import test from "node:test";
import assert from "node:assert/strict";

import {
  applyClaudeCodeEnvironment,
  type ClaudeCodeEnvironmentVariable,
  type ClaudeCredentials,
  getAccessTokenFromCredentials,
  getAccessTokenWithDependencies,
  getCredentialFilePath,
  getKeychainServiceNames,
  parseClaudeCredentials,
  resolveCredentialsConfigDir,
  withConfigDirSuffix,
} from "../credentials";

const validCredentials: ClaudeCredentials = {
  claudeAiOauth: {
    accessToken: "valid-token",
    refreshToken: "refresh-token",
    expiresAt: 2_000,
    scopes: ["scope"],
    subscriptionType: null,
    rateLimitTier: null,
  },
};

test("parseClaudeCredentials parses credential JSON", () => {
  const raw = JSON.stringify(validCredentials);

  assert.deepEqual(parseClaudeCredentials(raw), validCredentials);
});

test("getCredentialFilePath prefers configured Claude config dir", () => {
  assert.equal(getCredentialFilePath("/custom/claude", "/home/test", (...parts) => parts.join("/")), "/custom/claude/.credentials.json");
});

test("getCredentialFilePath falls back to ~/.claude/.credentials.json", () => {
  assert.equal(getCredentialFilePath(undefined, "/home/test", (...parts) => parts.join("/")), "/home/test/.claude/.credentials.json");
});

test("getAccessTokenFromCredentials returns the token when present and not expired", () => {
  assert.equal(getAccessTokenFromCredentials(validCredentials, 1_000), "valid-token");
});

test("getAccessTokenFromCredentials returns null when the token is expired", () => {
  assert.equal(getAccessTokenFromCredentials(validCredentials, 2_001), null);
});

test("getAccessTokenFromCredentials returns null when there is no access token", () => {
  assert.equal(
    getAccessTokenFromCredentials({
      claudeAiOauth: {
        ...validCredentials.claudeAiOauth!,
        accessToken: "",
      },
    }),
    null,
  );
});

test("getKeychainServiceNames returns the base service when no config dir is set", () => {
  assert.deepEqual(getKeychainServiceNames(undefined), ["Claude Code-credentials"]);
});

test("getKeychainServiceNames puts the config-dir-suffixed service before the base one", () => {
  assert.deepEqual(getKeychainServiceNames("/custom/claude"), ["Claude Code-credentials-7427f042", "Claude Code-credentials"]);
});

test("getKeychainServiceNames hashes the NFC form of the config dir", () => {
  const composed = "/Users/andr\u00e9/.claude";
  const decomposed = "/Users/andre\u0301/.claude";

  assert.notEqual(composed, decomposed);
  assert.deepEqual(getKeychainServiceNames(decomposed), getKeychainServiceNames(composed));
});

test("getAccessTokenWithDependencies reads the config-dir-suffixed keychain entry first", () => {
  const queriedServices: string[] = [];

  const token = getAccessTokenWithDependencies({
    platform: "darwin",
    configDir: "/custom/claude",
    homedir: () => "/home/test",
    joinPath: (...parts) => parts.join("/"),
    execSync: (command: string) => {
      queriedServices.push(command);
      return Buffer.from(JSON.stringify(validCredentials));
    },
    readFileSync: () => {
      throw new Error("should not be read");
    },
    now: () => 1_000,
  });

  assert.equal(token, "valid-token");
  assert.deepEqual(queriedServices, ['security find-generic-password -s "Claude Code-credentials-7427f042" -w']);
});

test("getAccessTokenWithDependencies falls back to the base keychain entry when the suffixed one is missing", () => {
  const queriedServices: string[] = [];

  const token = getAccessTokenWithDependencies({
    platform: "darwin",
    configDir: "/custom/claude",
    homedir: () => "/home/test",
    joinPath: (...parts) => parts.join("/"),
    execSync: (command: string) => {
      queriedServices.push(command);
      if (command.includes("Claude Code-credentials-7427f042")) {
        throw new Error("The specified item could not be found in the keychain.");
      }
      return Buffer.from(JSON.stringify(validCredentials));
    },
    readFileSync: () => {
      throw new Error("should not be read");
    },
    now: () => 1_000,
  });

  assert.equal(token, "valid-token");
  assert.deepEqual(queriedServices, [
    'security find-generic-password -s "Claude Code-credentials-7427f042" -w',
    'security find-generic-password -s "Claude Code-credentials" -w',
  ]);
});

test("getAccessTokenWithDependencies uses the macOS keychain when it returns a valid token", () => {
  let fileReadCalled = false;

  const token = getAccessTokenWithDependencies({
    platform: "darwin",
    configDir: undefined,
    homedir: () => "/home/test",
    joinPath: (...parts) => parts.join("/"),
    execSync: () => Buffer.from(JSON.stringify(validCredentials)),
    readFileSync: () => {
      fileReadCalled = true;
      return "";
    },
    now: () => 1_000,
  });

  assert.equal(token, "valid-token");
  assert.equal(fileReadCalled, false);
});

test("getAccessTokenWithDependencies falls back to the credentials file when keychain access fails", () => {
  const token = getAccessTokenWithDependencies({
    platform: "darwin",
    configDir: "/custom/claude",
    homedir: () => "/home/test",
    joinPath: (...parts) => parts.join("/"),
    execSync: () => {
      throw new Error("keychain unavailable");
    },
    readFileSync: (file: string) => {
      assert.equal(file, "/custom/claude/.credentials.json");
      return JSON.stringify(validCredentials);
    },
    now: () => 1_000,
  });

  assert.equal(token, "valid-token");
});

test("getAccessTokenWithDependencies falls back to the credentials file when the keychain token is expired", () => {
  const expiredCredentials: ClaudeCredentials = {
    claudeAiOauth: {
      ...validCredentials.claudeAiOauth!,
      expiresAt: 500,
    },
  };

  const token = getAccessTokenWithDependencies({
    platform: "darwin",
    configDir: undefined,
    homedir: () => "/home/test",
    joinPath: (...parts) => parts.join("/"),
    execSync: () => Buffer.from(JSON.stringify(expiredCredentials)),
    readFileSync: () => JSON.stringify(validCredentials),
    now: () => 1_000,
  });

  assert.equal(token, "valid-token");
});

test("getAccessTokenWithDependencies returns null when the credentials file cannot be read", () => {
  const token = getAccessTokenWithDependencies({
    platform: "linux",
    configDir: undefined,
    homedir: () => "/home/test",
    joinPath: (...parts) => parts.join("/"),
    execSync: () => Buffer.from(""),
    readFileSync: () => {
      throw new Error("missing file");
    },
    now: () => 1_000,
  });

  assert.equal(token, null);
});

test("resolveCredentialsConfigDir falls back to CLAUDE_CONFIG_DIR when CLAUDE_SECURESTORAGE_CONFIG_DIR is unset", () => {
  assert.equal(resolveCredentialsConfigDir({ CLAUDE_CONFIG_DIR: "/custom/claude" }), "/custom/claude");
});

test("resolveCredentialsConfigDir prefers CLAUDE_SECURESTORAGE_CONFIG_DIR when both are set", () => {
  assert.equal(
    resolveCredentialsConfigDir({
      CLAUDE_CONFIG_DIR: "/custom/claude",
      CLAUDE_SECURESTORAGE_CONFIG_DIR: "/other/profile",
    }),
    "/other/profile",
  );
});

test("resolveCredentialsConfigDir treats an empty CLAUDE_SECURESTORAGE_CONFIG_DIR as pinning the default store", () => {
  assert.equal(
    resolveCredentialsConfigDir({
      CLAUDE_CONFIG_DIR: "/custom/claude",
      CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
    }),
    undefined,
  );
});

test("resolveCredentialsConfigDir returns undefined when neither variable is set", () => {
  assert.equal(resolveCredentialsConfigDir({}), undefined);
});

test("resolveCredentialsConfigDir treats an empty CLAUDE_CONFIG_DIR as the default dir", () => {
  assert.equal(resolveCredentialsConfigDir({ CLAUDE_CONFIG_DIR: "" }), undefined);
});

test("withConfigDirSuffix keeps the bare name for the default config dir", () => {
  assert.equal(withConfigDirSuffix("usage-history", undefined), "usage-history");
});

test("withConfigDirSuffix uses the same hash as the config-dir-suffixed keychain entry", () => {
  assert.equal(withConfigDirSuffix("Claude Code-credentials", "/custom/claude"), "Claude Code-credentials-7427f042");
});

test("applyClaudeCodeEnvironment returns the process environment unchanged when the setting is unset", () => {
  assert.deepEqual(applyClaudeCodeEnvironment({ CLAUDE_CONFIG_DIR: "/custom/claude" }, undefined, "linux"), { CLAUDE_CONFIG_DIR: "/custom/claude" });
});

test("applyClaudeCodeEnvironment lets setting entries override the process environment", () => {
  const env = applyClaudeCodeEnvironment(
    { CLAUDE_CONFIG_DIR: "/home/test/.claude", PATH: "/usr/bin" },
    [{ name: "CLAUDE_CONFIG_DIR", value: "/home/test/.claude-work" }],
    "linux",
  );

  assert.deepEqual(env, { CLAUDE_CONFIG_DIR: "/home/test/.claude-work", PATH: "/usr/bin" });
});

test("applyClaudeCodeEnvironment skips malformed setting entries", () => {
  const malformed = [{ name: "CLAUDE_CONFIG_DIR" }, { value: "/orphan" }, null, { name: "CLAUDE_SECURESTORAGE_CONFIG_DIR", value: 42 }];

  assert.deepEqual(applyClaudeCodeEnvironment({}, malformed as unknown as ClaudeCodeEnvironmentVariable[], "linux"), {});
});

test("applyClaudeCodeEnvironment matches variable names case-insensitively on Windows", () => {
  const fromEnv = applyClaudeCodeEnvironment({ claude_config_dir: "C:\\Users\\test\\.claude-env" }, undefined, "win32");
  const fromSetting = applyClaudeCodeEnvironment(
    { CLAUDE_CONFIG_DIR: "C:\\Users\\test\\.claude" },
    [{ name: "Claude_Config_Dir", value: "C:\\Users\\test\\.claude-work" }],
    "win32",
  );

  assert.equal(resolveCredentialsConfigDir(fromEnv), "C:\\Users\\test\\.claude-env");
  assert.equal(resolveCredentialsConfigDir(fromSetting), "C:\\Users\\test\\.claude-work");
});

test("applyClaudeCodeEnvironment keeps variable names case-sensitive elsewhere", () => {
  const env = applyClaudeCodeEnvironment({ CLAUDE_CONFIG_DIR: "/home/test/.claude" }, [{ name: "claude_config_dir", value: "/other" }], "linux");

  assert.equal(resolveCredentialsConfigDir(env), "/home/test/.claude");
});

test("a profile's claudeCode.environmentVariables setting selects that profile's config dir", () => {
  const configDirFor = (variables: ClaudeCodeEnvironmentVariable[] | undefined) =>
    resolveCredentialsConfigDir(applyClaudeCodeEnvironment({}, variables, "linux"));

  assert.equal(configDirFor(undefined), undefined);
  assert.equal(configDirFor([{ name: "CLAUDE_CONFIG_DIR", value: "/home/test/.claude-work" }]), "/home/test/.claude-work");
  assert.equal(
    configDirFor([
      { name: "CLAUDE_CONFIG_DIR", value: "/home/test/.claude-work" },
      { name: "CLAUDE_SECURESTORAGE_CONFIG_DIR", value: "/home/test/.claude-secure" },
    ]),
    "/home/test/.claude-secure",
  );
});

test("getAccessTokenWithDependencies returns null when the credentials file contains invalid JSON", () => {
  const token = getAccessTokenWithDependencies({
    platform: "linux",
    configDir: undefined,
    homedir: () => "/home/test",
    joinPath: (...parts) => parts.join("/"),
    execSync: () => Buffer.from(""),
    readFileSync: () => "{not-json",
    now: () => 1_000,
  });

  assert.equal(token, null);
});
