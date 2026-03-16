import * as assert from "assert";
import * as vscode from "vscode";
import { COMMANDS, CONFIG_KEYS, CONFIG_SECTION } from "../config";

suite("Claude Code Usage", () => {
  test("extension activates successfully", async () => {
    const extension = vscode.extensions.getExtension("mhelbich.claude-code-usage-status");

    assert.ok(extension, "Expected the extension to be registered");

    await extension.activate();

    assert.strictEqual(extension.isActive, true);
  });

  test("refresh command is registered", async () => {
    const commands = await vscode.commands.getCommands(true);

    for (const cmd of Object.values(COMMANDS)) {
      assert.ok(commands.includes(cmd), `Expected ${cmd} command to be registered`);
    }
  });

  test("configuration settings are registered", async () => {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    for (const key of Object.keys(CONFIG_KEYS)) {
      assert.ok(config.has(key), `Expected ${key} setting to be registered`);
    }
  });
});
