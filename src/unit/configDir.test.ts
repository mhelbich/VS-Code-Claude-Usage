import test from "node:test";
import assert from "node:assert/strict";

import { applyClaudeCodeEnvironment, parseClaudeCodeEnvironmentVariables, resolveCredentialsConfigDir, withAccountSuffix, withConfigDirSuffix } from "../configDir";

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

test("resolveCredentialsConfigDir returns the NFC form of the config dir", () => {
  assert.equal(resolveCredentialsConfigDir({ CLAUDE_CONFIG_DIR: "/Users/re\u0301sume\u0301/.claude" }), "/Users/r\u00e9sum\u00e9/.claude");
});

test("withConfigDirSuffix keeps the bare name for the default config dir", () => {
  assert.equal(withConfigDirSuffix("usage-history", undefined), "usage-history");
});

test("withConfigDirSuffix uses the same hash as the config-dir-suffixed keychain entry", () => {
  assert.equal(withConfigDirSuffix("Claude Code-credentials", "/custom/claude"), "Claude Code-credentials-7427f042");
});

test("withAccountSuffix keeps the bare name for the default config dir", () => {
  assert.equal(withAccountSuffix("usage-history", undefined, "/home/test"), "usage-history");
});

test("withAccountSuffix keeps the bare name when the config dir points at ~/.claude explicitly", () => {
  assert.equal(withAccountSuffix("usage-history", "/home/test/.claude", "/home/test"), "usage-history");
  assert.equal(withAccountSuffix("usage-history", "/home/test/.claude/", "/home/test"), "usage-history");
});

test("withAccountSuffix uses the config dir hash for any other dir", () => {
  assert.equal(withAccountSuffix("usage-history", "/custom/claude", "/home/test"), "usage-history-7427f042");
});

// ─── claudeCode.environmentVariables (mirrors Claude Code 2.1.296) ─────────────

test("parseClaudeCodeEnvironmentVariables returns no entries when the setting is unset or not a list", () => {
  assert.deepEqual(parseClaudeCodeEnvironmentVariables(undefined), []);
  assert.deepEqual(parseClaudeCodeEnvironmentVariables("CLAUDE_CONFIG_DIR=/x"), []);
});

test("parseClaudeCodeEnvironmentVariables drops entries without a string name and stringifies values", () => {
  const raw = [{ name: "A" }, { value: "/orphan" }, null, "B", { name: "C", value: 42 }, { name: "D", value: null }, { name: "E", value: "e" }];

  assert.deepEqual(parseClaudeCodeEnvironmentVariables(raw), [
    { name: "A", value: "" },
    { name: "C", value: "42" },
    { name: "D", value: "" },
    { name: "E", value: "e" },
  ]);
});

test("parseClaudeCodeEnvironmentVariables accepts the legacy object form", () => {
  assert.deepEqual(parseClaudeCodeEnvironmentVariables({ CLAUDE_CONFIG_DIR: "/home/test/.claude-work", N: 1 }), [
    { name: "CLAUDE_CONFIG_DIR", value: "/home/test/.claude-work" },
    { name: "N", value: "1" },
  ]);
});

test("applyClaudeCodeEnvironment returns the process environment unchanged when the setting is empty", () => {
  assert.deepEqual(applyClaudeCodeEnvironment({ CLAUDE_CONFIG_DIR: "/custom/claude" }, [], "linux"), { CLAUDE_CONFIG_DIR: "/custom/claude" });
});

test("applyClaudeCodeEnvironment lets setting entries override the process environment", () => {
  const env = applyClaudeCodeEnvironment(
    { CLAUDE_CONFIG_DIR: "/home/test/.claude", PATH: "/usr/bin" },
    [{ name: "CLAUDE_CONFIG_DIR", value: "/home/test/.claude-work" }],
    "linux",
  );

  assert.deepEqual(env, { CLAUDE_CONFIG_DIR: "/home/test/.claude-work", PATH: "/usr/bin" });
});

test("applyClaudeCodeEnvironment ignores a relative or empty CLAUDE_CONFIG_DIR from the setting", () => {
  const env = { CLAUDE_CONFIG_DIR: "/home/test/.claude-env" };

  for (const value of ["", ".claude-work", "~/.claude-work"]) {
    assert.equal(applyClaudeCodeEnvironment(env, [{ name: "CLAUDE_CONFIG_DIR", value }], "linux").CLAUDE_CONFIG_DIR, "/home/test/.claude-env");
  }
  assert.equal(applyClaudeCodeEnvironment({}, [{ name: "CLAUDE_CONFIG_DIR", value: "relative" }], "linux").CLAUDE_CONFIG_DIR, undefined);
});

test("applyClaudeCodeEnvironment uses the last absolute CLAUDE_CONFIG_DIR entry", () => {
  const env = applyClaudeCodeEnvironment(
    {},
    [
      { name: "CLAUDE_CONFIG_DIR", value: "/home/test/.claude-a" },
      { name: "CLAUDE_CONFIG_DIR", value: "/home/test/.claude-b" },
      { name: "CLAUDE_CONFIG_DIR", value: "relative" },
    ],
    "linux",
  );

  assert.equal(env.CLAUDE_CONFIG_DIR, "/home/test/.claude-b");
});

test("applyClaudeCodeEnvironment applies CLAUDE_SECURESTORAGE_CONFIG_DIR from the setting as given, even when empty", () => {
  const env = applyClaudeCodeEnvironment({ CLAUDE_CONFIG_DIR: "/home/test/.claude-work" }, [{ name: "CLAUDE_SECURESTORAGE_CONFIG_DIR", value: "" }], "linux");

  assert.equal(resolveCredentialsConfigDir(env), undefined);
});

test("applyClaudeCodeEnvironment requires a drive letter or UNC path for CLAUDE_CONFIG_DIR on Windows", () => {
  const configDirFor = (value: string) => applyClaudeCodeEnvironment({}, [{ name: "CLAUDE_CONFIG_DIR", value }], "win32").CLAUDE_CONFIG_DIR;

  assert.equal(configDirFor("C:\\Users\\test\\.claude-work"), "C:\\Users\\test\\.claude-work");
  assert.equal(configDirFor("D:/claude"), "D:/claude");
  assert.equal(configDirFor("\\\\server\\share\\claude"), "\\\\server\\share\\claude");
  assert.equal(configDirFor("\\claude"), undefined);
  assert.equal(configDirFor("C:claude"), undefined);
});

test("applyClaudeCodeEnvironment checks CLAUDE_CONFIG_DIR as a Windows path when a process wrapper is set", () => {
  const configDirFor = (value: string, platform: NodeJS.Platform) =>
    applyClaudeCodeEnvironment({}, [{ name: "CLAUDE_CONFIG_DIR", value }], platform, true).CLAUDE_CONFIG_DIR;

  assert.equal(configDirFor("\\claude", "win32"), "\\claude");
  assert.equal(configDirFor("C:\\claude", "linux"), "C:\\claude");
  assert.equal(configDirFor("relative", "linux"), undefined);
});

test("applyClaudeCodeEnvironment matches variable names case-insensitively on Windows", () => {
  const fromEnv = applyClaudeCodeEnvironment({ claude_config_dir: "C:\\Users\\test\\.claude-env" }, [], "win32");
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
  const configDirFor = (raw: unknown) => resolveCredentialsConfigDir(applyClaudeCodeEnvironment({}, parseClaudeCodeEnvironmentVariables(raw), "linux"));

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
