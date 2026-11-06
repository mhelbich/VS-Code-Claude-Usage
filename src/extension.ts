import * as vscode from "vscode";
import { fetchUsage } from "./api";
import { readCache, writeCache } from "./cache";
import { CLAUDE_CODE_ENVIRONMENT_SETTING, CLAUDE_CODE_PROCESS_WRAPPER_SETTING, COMMANDS, CONFIG_PATHS, getClaudeConfigDir, getClaudeUsageSetting } from "./config";
import { withAccountSuffix } from "./configDir";
import { getAccessToken } from "./credentials";
import { EMPTY_FORECAST_PROFILE, updateForecastProfile, type ForecastProfile } from "./forecast";
import { getHistoryFileName, HistoryStore } from "./history";
import { refreshUsage } from "./refresh";
import { Action, BarProps, State, forecastStateToBarProps, reduce, stateToBarProps } from "./statusBar";
import { UsageHistoryProvider } from "./webviewProvider";

function applyProps(props: BarProps, bar: vscode.StatusBarItem): void {
  bar.text = props.text;
  bar.color = props.color ? new vscode.ThemeColor(props.color) : undefined;
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
  if (props.visible === false) {
    bar.hide();
  } else {
    bar.show();
  }
}

// ─── Extension lifecycle ──────────────────────────────────────────────────────

export function activate(ctx: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("Claude Code Usage", { log: true });
  ctx.subscriptions.push(log);

  // Only the Claude Code extension's settings can change this at runtime; see the listener below.
  let configDir = getClaudeConfigDir();

  const historyStore = new HistoryStore(
    () => vscode.Uri.joinPath(ctx.globalStorageUri, getHistoryFileName(configDir)).fsPath,
    (msg) => log.warn(msg),
    () => getClaudeUsageSetting("historyRetentionDays"),
  );
  const historyProvider = new UsageHistoryProvider(ctx.extensionUri, historyStore, ctx.globalState);
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(UsageHistoryProvider.viewId, historyProvider));

  // Create status bar item
  const bar = vscode.window.createStatusBarItem("claudeUsage.main", vscode.StatusBarAlignment.Right, 100);
  bar.name = "Claude Usage";
  bar.command = COMMANDS.refresh;
  ctx.subscriptions.push(bar);

  const forecastBar = vscode.window.createStatusBarItem("claudeUsage.forecast", vscode.StatusBarAlignment.Right, 99);
  forecastBar.name = "Claude Usage Forecast";
  forecastBar.command = COMMANDS.refresh;
  ctx.subscriptions.push(forecastBar);

  function onIncompleteForecastWeek(reset: number, sampleCount: number): void {
    log.debug(`Weekly forecast profile: dropping week ending ${new Date(reset).toISOString()} — only ${sampleCount} usable sample(s), not enough coverage to learn from`);
  }

  let state: State = { kind: "loading" };
  const forecastProfileKey = () => withAccountSuffix("weeklyForecastProfile.v1", configDir);

  function loadForecastProfile(): ForecastProfile {
    const profile = updateForecastProfile(
      ctx.globalState.get<ForecastProfile>(forecastProfileKey()) ?? EMPTY_FORECAST_PROFILE,
      historyStore.read(),
      undefined,
      onIncompleteForecastWeek,
    );
    void ctx.globalState.update(forecastProfileKey(), profile);
    return profile;
  }

  let forecastProfile = loadForecastProfile();

  function getHistoryViewSettings() {
    // Keep persisted defaults in one place; the webview can still override them locally per session.
    return {
      showSessionResetMarkers: getClaudeUsageSetting("showSessionResetMarkers"),
      showWeeklyResetMarkers: getClaudeUsageSetting("showWeeklyResetMarkers"),
      showWeeklyForecast: getClaudeUsageSetting("showWeeklyForecast"),
      showScopedWeeklyLimits: getClaudeUsageSetting("showScopedWeeklyLimits"),
    };
  }

  function dispatch(action: Action): void {
    state = reduce(state, action);
    const showUsed = getClaudeUsageSetting("showUsed");
    applyProps(stateToBarProps(state, showUsed, getClaudeUsageSetting("showScopedWeeklyLimits")), bar);
    applyProps(forecastStateToBarProps(state, showUsed), forecastBar);
  }

  historyProvider.refresh(historyStore.read(), getClaudeUsageSetting("showUsed"), getHistoryViewSettings(), null);

  let timer: ReturnType<typeof setInterval> | undefined;
  ctx.subscriptions.push(
    new vscode.Disposable(() => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    }),
  );

  function refresh(force = false): Promise<void> {
    return refreshUsage(
      {
        getConfigDir: () => configDir,
        readCache,
        writeCache,
        getAccessToken,
        fetchUsage,
        getForecastProfile: () => forecastProfile,
        saveForecastProfile: (profile) => {
          forecastProfile = profile;
          return ctx.globalState.update(forecastProfileKey(), profile);
        },
        appendHistory: (entry) => historyStore.append(entry),
        showUsage: (usage, forecast) => {
          historyProvider.refresh(historyStore.read(), getClaudeUsageSetting("showUsed"), getHistoryViewSettings(), forecast);
          dispatch({
            type: "fetch-success",
            usage,
            forecast,
            thresholds: {
              warning: getClaudeUsageSetting("warningThreshold"),
              danger: getClaudeUsageSetting("dangerThreshold"),
            },
          });
        },
        dispatch,
        getRefreshIntervalSeconds: () => getClaudeUsageSetting("refreshIntervalSeconds"),
        onIncompleteForecastWeek,
        log,
        now: () => Date.now(),
      },
      force,
    );
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
      if (e.affectsConfiguration(CLAUDE_CODE_ENVIRONMENT_SETTING) || e.affectsConfiguration(CLAUDE_CODE_PROCESS_WRAPPER_SETTING)) {
        const updatedConfigDir = getClaudeConfigDir();
        if (updatedConfigDir !== configDir) {
          configDir = updatedConfigDir;
          log.info(`Claude config dir changed — ${configDir ?? "default"}`);
          forecastProfile = loadForecastProfile();
          historyProvider.refresh(historyStore.read(), getClaudeUsageSetting("showUsed"), getHistoryViewSettings(), null);
          // Not forced: the cache is per config dir, so a fresh entry for this account can be reused.
          refresh();
        }
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
        historyProvider.refresh(historyStore.read(), getClaudeUsageSetting("showUsed"), getHistoryViewSettings(), state.kind === "ok" ? state.forecast ?? null : null);
      }
      if (
        e.affectsConfiguration(CONFIG_PATHS.showUsed) ||
        e.affectsConfiguration(CONFIG_PATHS.showSessionResetMarkers) ||
        e.affectsConfiguration(CONFIG_PATHS.showWeeklyResetMarkers) ||
        e.affectsConfiguration(CONFIG_PATHS.showWeeklyForecast) ||
        e.affectsConfiguration(CONFIG_PATHS.showScopedWeeklyLimits)
      ) {
        const showUsed = getClaudeUsageSetting("showUsed");
        log.info(`Display settings updated — showUsed: ${showUsed}`);
        applyProps(stateToBarProps(state, showUsed, getClaudeUsageSetting("showScopedWeeklyLimits")), bar);
        applyProps(forecastStateToBarProps(state, showUsed), forecastBar);
        historyProvider.refresh(historyStore.read(), showUsed, getHistoryViewSettings(), state.kind === "ok" ? state.forecast ?? null : null);
      }
    }),
  );

  // Initialize status bar immediately then kick off async refresh
  const intervalSeconds = getClaudeUsageSetting("refreshIntervalSeconds");
  log.info(`Activated — refresh interval: ${intervalSeconds}s`);
  applyProps(stateToBarProps(state, getClaudeUsageSetting("showUsed"), getClaudeUsageSetting("showScopedWeeklyLimits")), bar);
  applyProps(forecastStateToBarProps(state, getClaudeUsageSetting("showUsed")), forecastBar);
  refresh();
  startTimer();
}

export function deactivate() {}
