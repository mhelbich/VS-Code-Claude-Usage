import * as vscode from "vscode";
import { fetchUsage } from "./api";
import { isCacheFresh, readCache, writeCache } from "./cache";
import { COMMANDS, CONFIG_PATHS, getClaudeUsageSetting } from "./config";
import { getAccessToken } from "./credentials";
import { HistoryStore } from "./history";
import { Action, BarProps, State, reduce, stateToBarProps } from "./statusBar";
import type { HistoryEntry } from "./types";
import { UsageHistoryProvider } from "./webviewProvider";

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
  const log = vscode.window.createOutputChannel("Claude Code Usage", { log: true });
  ctx.subscriptions.push(log);

  const historyStore = new HistoryStore(
    vscode.Uri.joinPath(ctx.globalStorageUri, "usage-history.json").fsPath,
    (msg) => log.warn(msg),
    () => getClaudeUsageSetting("historyRetentionDays"),
  );
  const historyProvider = new UsageHistoryProvider(ctx.extensionUri, historyStore);
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(UsageHistoryProvider.viewId, historyProvider));

  // Create status bar item
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.command = COMMANDS.refresh;
  bar.show();
  ctx.subscriptions.push(bar);

  let state: State = { kind: "loading" };

  function dispatch(action: Action): void {
    state = reduce(state, action);
    applyProps(stateToBarProps(state, getClaudeUsageSetting("showUsed")), bar);
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

  async function refresh(force = false) {
    dispatch({ type: "refresh-started" });

    const intervalSeconds = getClaudeUsageSetting("refreshIntervalSeconds");
    const cached = readCache();
    if (!force && cached && isCacheFresh(cached, intervalSeconds)) {
      const ageSeconds = Math.round((Date.now() - cached.fetchedAt) / 1000);
      log.debug(`Cache hit (${ageSeconds}s old) — skipping API call`);
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

    log.debug("Cache missing or stale — fetching from API");
    const token = getAccessToken();
    if (!token) {
      log.warn("No valid access token found — run `claude /login` to sign in");
      dispatch({ type: "no-token" });
      return;
    }
    try {
      const usage = await fetchUsage(token);
      if (!usage) {
        log.error("API request returned a non-2xx response");
        dispatch({ type: "fetch-error" });
        return;
      }
      writeCache(usage);
      log.info("Usage fetched successfully");
      const entry: HistoryEntry = {
        timestamp: Date.now(),
        five_hour: usage.five_hour?.utilization ?? null,
        seven_day: usage.seven_day?.utilization ?? null,
        seven_day_opus: usage.seven_day_opus?.utilization ?? null,
        extra_used: usage.extra_usage?.used_credits ?? null,
        extra_limit: usage.extra_usage?.monthly_limit ?? null,
      };
      historyStore.append(entry);
      historyProvider.refresh(historyStore.read(), getClaudeUsageSetting("showUsed"));
      dispatch({
        type: "fetch-success",
        usage,
        thresholds: {
          warning: getClaudeUsageSetting("warningThreshold"),
          danger: getClaudeUsageSetting("dangerThreshold"),
        },
      });
    } catch (e) {
      log.error(`Unexpected error during fetch: ${String(e)}`);
      dispatch({ type: "fetch-error", message: String(e) });
    }
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    const intervalSeconds = getClaudeUsageSetting("refreshIntervalSeconds");
    log.info(`Refresh timer set to ${intervalSeconds}s`);
    timer = setInterval(refresh, intervalSeconds * 1000);
  }

  // Register commands and listeners
  ctx.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.refresh, () => {
      log.info("Manual refresh triggered");
      refresh(true);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_PATHS.refreshIntervalSeconds)) {
        startTimer();
      }
      if (e.affectsConfiguration(CONFIG_PATHS.warningThreshold) || e.affectsConfiguration(CONFIG_PATHS.dangerThreshold)) {
        const warning = getClaudeUsageSetting("warningThreshold");
        const danger = getClaudeUsageSetting("dangerThreshold");
        log.info(`Thresholds updated — warning: ${warning}%, danger: ${danger}%`);
        dispatch({
          type: "thresholds-changed",
          thresholds: { warning, danger },
        });
      }
      if (e.affectsConfiguration(CONFIG_PATHS.historyRetentionDays)) {
        log.info(`History retention updated — ${getClaudeUsageSetting("historyRetentionDays")} days`);
        historyProvider.refresh(historyStore.read(), getClaudeUsageSetting("showUsed"));
      }
      if (e.affectsConfiguration(CONFIG_PATHS.showUsed)) {
        const showUsed = getClaudeUsageSetting("showUsed");
        log.info(`Display mode updated — showUsed: ${showUsed}`);
        applyProps(stateToBarProps(state, showUsed), bar);
        historyProvider.refresh(historyStore.read(), showUsed);
      }
    }),
  );

  // Initialize status bar immediately then kick off async refresh
  const intervalSeconds = getClaudeUsageSetting("refreshIntervalSeconds");
  log.info(`Activated — refresh interval: ${intervalSeconds}s`);
  applyProps(stateToBarProps(state, getClaudeUsageSetting("showUsed")), bar);
  refresh();
  startTimer();
}

export function deactivate() {}
