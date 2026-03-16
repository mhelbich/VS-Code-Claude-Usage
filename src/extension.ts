import * as vscode from "vscode";
import { fetchUsage } from "./api";
import { COMMANDS, CONFIG_PATHS, getClaudeUsageSetting } from "./config";
import { getAccessToken } from "./credentials";
import { buildStatusText, buildTooltipMarkdown } from "./render";
import { ColorThresholds, UsageResponse } from "./types";

function buildTooltip(usage: UsageResponse, t: ColorThresholds): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.supportHtml = true;
  md.appendMarkdown(buildTooltipMarkdown(usage, t));
  return md;
}

// ─── Extension lifecycle ──────────────────────────────────────────────────────

export function activate(ctx: vscode.ExtensionContext) {
  const thresholds = (): ColorThresholds => ({
    warning: getClaudeUsageSetting("warningThreshold"),
    danger: getClaudeUsageSetting("dangerThreshold"),
  });

  // Create status bar item
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.command = COMMANDS.refresh;
  bar.text = "$(pulse) Claude …";
  bar.tooltip = "Claude Code usage — loading";
  bar.show();
  ctx.subscriptions.push(bar);

  let timer: ReturnType<typeof setInterval> | undefined;
  ctx.subscriptions.push(
    new vscode.Disposable(() => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    }),
  );

  /**
   * Fetch usage data and update the status bar item accordingly, handling various error states (no token, API error, etc.) and displaying appropriate text, colors, and tooltips based on the current usage and configured thresholds.
   * This function is called when the extension is activated, when the user clicks the status bar item to refresh, and whenever relevant configuration settings are changed.
   */
  async function refresh() {
    const token = getAccessToken();
    // ERROR: No Token
    if (!token) {
      bar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      bar.text = "$(pulse) Claude ✗";
      bar.tooltip = new vscode.MarkdownString("Claude Code: not logged in — run `claude /login`");
      return;
    }

    try {
      const usage = await fetchUsage(token);
      // ERROR: No Usage data
      if (!usage) {
        bar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        bar.text = "$(pulse) Claude !";
        bar.tooltip = "Claude Code: API error";
        return;
      }
      const thresholdsValue = thresholds();
      bar.text = buildStatusText(usage, thresholdsValue);
      bar.tooltip = buildTooltip(usage, thresholdsValue);
    } catch (e) {
      // ERROR: API call failed
      bar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      bar.text = "$(pulse) Claude !";
      bar.tooltip = new vscode.MarkdownString(`Claude Code\n\`${String(e)}\``);
    }
  }

  /**
   * Start or restart the refresh timer based on the current configuration setting, used when the extension is activated and whenever the refresh interval setting is changed by the user.
   */
  function startTimer() {
    if (timer) clearInterval(timer);
    const intervalMs = getClaudeUsageSetting("refreshIntervalSeconds") * 1000;
    timer = setInterval(refresh, intervalMs);
  }

  // Register commands and listeners
  ctx.subscriptions.push(
    // Commands
    vscode.commands.registerCommand(COMMANDS.refresh, () => {
      refresh();
    }),
    // React to config changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_PATHS.refreshIntervalSeconds)) {
        startTimer();
      }
      if (e.affectsConfiguration(CONFIG_PATHS.warningThreshold) || e.affectsConfiguration(CONFIG_PATHS.dangerThreshold)) {
        refresh();
      }
    }),
  );

  // Kick off
  refresh();
  startTimer();
}

export function deactivate() {}
