import test from "node:test";
import assert from "node:assert/strict";

import { diffAccounts, parseAccountsSetting, resolveAccounts, type Account } from "../accounts";

const HOME = "/home/test";

// ─── parseAccountsSetting ──────────────────────────────────────────────────────

test("parseAccountsSetting returns no entries when the setting is unset or not a list", () => {
  assert.deepEqual(parseAccountsSetting(undefined), []);
  assert.deepEqual(parseAccountsSetting({ label: "Work", configDir: "/x" }), []);
});

test("parseAccountsSetting drops entries that aren't objects or have non-string fields", () => {
  const raw = [null, "Work", { label: 1, configDir: "/a" }, { label: "B", configDir: 2 }, { label: " C ", configDir: "/c" }, { configDir: "/d" }, { label: "  " }];

  assert.deepEqual(parseAccountsSetting(raw), [
    { label: "C", configDir: "/c" },
    { label: undefined, configDir: "/d" },
    { label: undefined, configDir: undefined },
  ]);
});

// ─── resolveAccounts ───────────────────────────────────────────────────────────

test("resolveAccounts without the setting monitors the account Claude uses in this window", () => {
  const { accounts, warnings } = resolveAccounts([], "/home/test/.claude-work", HOME, "linux");

  assert.equal(accounts.length, 1);
  assert.match(accounts[0].key, /^account-[0-9a-f]{8}$/);
  assert.equal(accounts[0].label, undefined);
  assert.equal(accounts[0].configDir, "/home/test/.claude-work");
  assert.equal(accounts[0].active, true);
  assert.deepEqual(warnings, []);
});

test("resolveAccounts without the setting and without CLAUDE_CONFIG_DIR uses the default dir", () => {
  const { accounts } = resolveAccounts([], undefined, HOME, "linux");

  assert.deepEqual(accounts, [{ key: "account", configDir: undefined, active: true }]);
});

test("resolveAccounts keeps the listed order and marks the account Claude uses in this window", () => {
  const { accounts } = resolveAccounts(
    [
      { label: "Team", configDir: "~/.claude" },
      { label: "Personal", configDir: "~/.claude-personal" },
    ],
    "/home/test/.claude-personal",
    HOME,
    "linux",
  );

  assert.deepEqual(
    accounts.map(({ label, configDir, active }) => ({ label, configDir, active })),
    [
      { label: "Team", configDir: "/home/test/.claude", active: false },
      { label: "Personal", configDir: "/home/test/.claude-personal", active: true },
    ],
  );
});

test("resolveAccounts gives an explicit ~/.claude the default account's key, history and active state", () => {
  const { accounts } = resolveAccounts([{ label: "Team", configDir: "/home/test/.claude/" }], undefined, HOME, "linux");

  assert.equal(accounts[0].key, "account");
  assert.equal(accounts[0].active, true);
});

test("resolveAccounts treats an empty configDir as the default dir", () => {
  const { accounts } = resolveAccounts([{ label: "Default", configDir: "" }, { label: "Missing" }], undefined, HOME, "linux");

  assert.deepEqual(accounts, [{ key: "account", label: "Default", configDir: undefined, active: true }]);
});

test("resolveAccounts skips relative dirs with a warning", () => {
  const { accounts, warnings } = resolveAccounts(
    [
      { label: "Relative", configDir: "claude-work" },
      { label: "Work", configDir: "/srv/claude-work" },
    ],
    undefined,
    HOME,
    "linux",
  );

  assert.deepEqual(
    accounts.map((account) => account.label),
    ["Work"],
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Relative.*not an absolute path/);
});

test("resolveAccounts merges entries for the same dir, keeping the first", () => {
  const { accounts, warnings } = resolveAccounts(
    [
      { label: "Work", configDir: "~/.claude-work" },
      { label: "Again", configDir: "/home/test/.claude-work/" },
    ],
    undefined,
    HOME,
    "linux",
  );

  assert.deepEqual(
    accounts.map((account) => account.label),
    ["Work"],
  );
  assert.match(warnings[0], /Again.*same config dir as "Work"/);
});

test("resolveAccounts on Windows matches dirs regardless of casing and separators", () => {
  const { accounts } = resolveAccounts(
    [
      { label: "Team", configDir: "c:/users/me/.claude" },
      { label: "Work", configDir: "~\\.claude-work" },
      { label: "Again", configDir: "C:\\USERS\\ME\\.CLAUDE-WORK" },
    ],
    "c:\\users\\me\\.claude-work",
    "C:\\Users\\Me",
    "win32",
  );

  assert.deepEqual(
    accounts.map(({ key, label, active }) => ({ isDefault: key === "account", label, active })),
    [
      { isDefault: true, label: "Team", active: false },
      { isDefault: false, label: "Work", active: true },
    ],
  );
});

test("resolveAccounts labels an entry without a label after its dir", () => {
  const { accounts } = resolveAccounts([{ configDir: "/srv/claude-work" }, { configDir: "" }], undefined, HOME, "linux");

  assert.deepEqual(
    accounts.map((account) => account.label),
    ["claude-work", ".claude"],
  );
});

test("resolveAccounts falls back to the active account when no entry is usable", () => {
  const { accounts, warnings } = resolveAccounts([{ label: "Relative", configDir: "relative" }], undefined, HOME, "linux");

  assert.deepEqual(accounts, [{ key: "account", configDir: undefined, active: true }]);
  assert.equal(warnings.length, 2);
});

// ─── diffAccounts ──────────────────────────────────────────────────────────────

const account = (key: string, label = key): Account => ({ key, label, configDir: `/srv/${key}`, active: false });

test("diffAccounts keeps, adds and removes monitors by key", () => {
  const { keep, add, remove } = diffAccounts(["a", "b"], [account("b", "B renamed"), account("c")]);

  assert.deepEqual(keep, [account("b", "B renamed")]);
  assert.deepEqual(add, [account("c")]);
  assert.deepEqual(remove, ["a"]);
});

test("diffAccounts changes nothing for the same keys", () => {
  const { keep, add, remove } = diffAccounts(["a"], [account("a")]);

  assert.deepEqual(keep, [account("a")]);
  assert.deepEqual(add, []);
  assert.deepEqual(remove, []);
});
