import * as vscode from "vscode";
import { fetchUsage } from "./api";
import { isCacheFresh, readCache, writeCache } from "./cache";
import { COMMANDS, CONFIG_PATHS, getClaudeUsageSetting } from "./config";
import { getAccessToken } from "./credentials";
import { Action, BarProps, State, reduce, stateToBarProps } from "./statusBar";

function applyProps(props: BarProps, bar: vscode.StatusBarItem): void {
  bar.text = props.text;
  bar.backgroundColor = props.backgroundColor ? new vscode.ThemeColor(`statusBarItem.${props.backgroundColor}Background`) : undefined;
  if (props.tooltipIsMarkdown) {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.supportHtml = true;
    md.appendMarkdown(props.tooltipText);
    bar.tooltip = md;
  } else {
    bar.tooltip = props.tooltipText;
  }
}

// ─── Extension lifecycle ──────────────────────────────────────────────────────

export function activate(ctx: vscode.ExtensionContext) {
  // Create status bar item
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.command = COMMANDS.refresh;
  bar.show();
  ctx.subscriptions.push(bar);

  let state: State = { kind: "loading" };

  function dispatch(action: Action): void {
    state = reduce(state, action);
    applyProps(stateToBarProps(state), bar);
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  ctx.subscriptions.push(
    new vscode.Disposable(() => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    }),
  );

  async function refresh() {
    dispatch({ type: "refresh-started" });

    const intervalSeconds = getClaudeUsageSetting("refreshIntervalSeconds");
    const cached = readCache();
    if (cached && isCacheFresh(cached, intervalSeconds)) {
      dispatch({
        type: "fetch-success",
        usage: cached.data,
        thresholds: {
          warning: getClaudeUsageSetting("warningThreshold"),
          danger: getClaudeUsageSetting("dangerThreshold"),
        },
      });
      return;
    }

    const token = getAccessToken();
    if (!token) {
      dispatch({ type: "no-token" });
      return;
    }
    try {
      const usage = await fetchUsage(token);
      if (!usage) {
        dispatch({ type: "fetch-error" });
        return;
      }
      writeCache(usage);
      dispatch({
        type: "fetch-success",
        usage,
        thresholds: {
          warning: getClaudeUsageSetting("warningThreshold"),
          danger: getClaudeUsageSetting("dangerThreshold"),
        },
      });
    } catch (e) {
      dispatch({ type: "fetch-error", message: String(e) });
    }
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    const intervalMs = getClaudeUsageSetting("refreshIntervalSeconds") * 1000;
    timer = setInterval(refresh, intervalMs);
  }

  // Register commands and listeners
  ctx.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.refresh, () => {
      refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_PATHS.refreshIntervalSeconds)) {
        startTimer();
      }
      if (e.affectsConfiguration(CONFIG_PATHS.warningThreshold) || e.affectsConfiguration(CONFIG_PATHS.dangerThreshold)) {
        dispatch({
          type: "thresholds-changed",
          thresholds: {
            warning: getClaudeUsageSetting("warningThreshold"),
            danger: getClaudeUsageSetting("dangerThreshold"),
          },
        });
      }
    }),
  );

  // Initialize status bar immediately then kick off async refresh
  applyProps(stateToBarProps(state), bar);
  refresh();
  startTimer();
}

export function deactivate() {}
