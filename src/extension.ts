import * as os from "os";
import * as vscode from "vscode";
import { AccountMonitor, type AccountMonitorEnvironment } from "./accountMonitor";
import { diffAccounts, parseAccountsSetting, resolveAccounts } from "./accounts";
import { CLAUDE_CODE_ENVIRONMENT_SETTING, CLAUDE_CODE_PROCESS_WRAPPER_SETTING, COMMANDS, CONFIG_PATHS, getClaudeConfigDir, getClaudeUsageSetting } from "./config";
import { UsageHistoryProvider } from "./webviewProvider";

// ─── Extension lifecycle ──────────────────────────────────────────────────────

export function activate(ctx: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("Claude Code Usage", { log: true });
  ctx.subscriptions.push(log);

  // Monitored accounts in list order: the one Claude in this window uses, or those in claudeUsage.accounts.
  const monitors = new Map<string, AccountMonitor>();
  // The account picked in the history panel's dropdown; undefined follows the active account.
  let panelKey: string | undefined;

  function panelMonitor(): AccountMonitor {
    const all = [...monitors.values()];
    return (panelKey !== undefined ? monitors.get(panelKey) : undefined) ?? all.find((monitor) => monitor.active) ?? all[0];
  }

  function getHistoryViewSettings() {
    // Keep persisted defaults in one place; the webview can still override them locally per session.
    return {
      showSessionResetMarkers: getClaudeUsageSetting("showSessionResetMarkers"),
      showWeeklyResetMarkers: getClaudeUsageSetting("showWeeklyResetMarkers"),
      showWeeklyForecast: getClaudeUsageSetting("showWeeklyForecast"),
      showScopedWeeklyLimits: getClaudeUsageSetting("showScopedWeeklyLimits"),
    };
  }

  const historyProvider = new UsageHistoryProvider(
    ctx.extensionUri,
    () => panelMonitor().history,
    ctx.globalState,
    (key) => {
      panelKey = key;
      refreshPanel();
    },
  );
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(UsageHistoryProvider.viewId, historyProvider));

  function refreshPanel(): void {
    const shown = panelMonitor();
    historyProvider.setAccounts(
      [...monitors.values()].map((monitor) => ({ key: monitor.key, label: monitor.label ?? "", active: monitor.active })),
      shown.key,
    );
    historyProvider.refresh(shown.history.read(), getClaudeUsageSetting("showUsed"), getHistoryViewSettings(), shown.forecast);
  }

  const monitorEnvironment: AccountMonitorEnvironment = {
    globalStorageUri: ctx.globalStorageUri,
    globalState: ctx.globalState,
    log,
    onHistoryChanged: (monitor) => {
      if (monitor === panelMonitor()) {
        refreshPanel();
      }
    },
  };

  /** Brings the monitors in line with the account list; returns the new ones, which still need a refresh. */
  function reconcile(): AccountMonitor[] {
    const { accounts, warnings } = resolveAccounts(parseAccountsSetting(getClaudeUsageSetting("accounts")), getClaudeConfigDir(), os.homedir());
    for (const warning of warnings) {
      log.warn(warning);
    }

    const { add, remove } = diffAccounts(monitors.keys(), accounts);
    for (const key of remove) {
      monitors.get(key)?.dispose();
      monitors.delete(key);
    }

    const added: AccountMonitor[] = [];
    const ordered = new Map<string, AccountMonitor>();
    accounts.forEach((account, index) => {
      let monitor = monitors.get(account.key);
      if (monitor) {
        monitor.update(account, index);
      } else {
        monitor = new AccountMonitor(account, index, monitorEnvironment);
        added.push(monitor);
      }
      ordered.set(account.key, monitor);
    });
    monitors.clear();
    for (const [key, monitor] of ordered) {
      monitors.set(key, monitor);
    }

    if (add.length || remove.length) {
      const names = accounts.map((account) => `${account.label ?? account.configDir ?? "~/.claude"}${account.active ? " (active)" : ""}`);
      log.info(`Monitoring ${names.join(", ")}`);
    }
    if (panelKey !== undefined && !monitors.has(panelKey)) {
      panelKey = undefined;
    }
    refreshPanel();
    return added;
  }

  async function refreshAll(force = false): Promise<void> {
    await Promise.all([...monitors.values()].map((monitor) => monitor.refresh(force)));
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  ctx.subscriptions.push(
    new vscode.Disposable(() => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      for (const monitor of monitors.values()) {
        monitor.dispose();
      }
      monitors.clear();
    }),
  );

  function startTimer() {
    if (timer) clearInterval(timer);
    const intervalSeconds = getClaudeUsageSetting("refreshIntervalSeconds");
    log.info(`Refresh timer set to ${intervalSeconds}s`);
    timer = setInterval(() => void refreshAll(), intervalSeconds * 1000);
  }

  // Register commands and listeners
  ctx.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.refresh, () => {
      log.info("Manual refresh triggered");
      void refreshAll(true);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_PATHS.refreshIntervalSeconds)) {
        startTimer();
      }
      if (
        e.affectsConfiguration(CONFIG_PATHS.accounts) ||
        e.affectsConfiguration(CLAUDE_CODE_ENVIRONMENT_SETTING) ||
        e.affectsConfiguration(CLAUDE_CODE_PROCESS_WRAPPER_SETTING)
      ) {
        // Not forced: the cache is per config dir, so a fresh entry for a new account can be reused.
        for (const monitor of reconcile()) {
          void monitor.refresh();
        }
      }
      if (e.affectsConfiguration(CONFIG_PATHS.warningThreshold) || e.affectsConfiguration(CONFIG_PATHS.dangerThreshold)) {
        const warning = getClaudeUsageSetting("warningThreshold");
        const danger = getClaudeUsageSetting("dangerThreshold");
        log.info(`Thresholds updated — warning: ${warning}%, danger: ${danger}%`);
        for (const monitor of monitors.values()) {
          monitor.thresholdsChanged({ warning, danger });
        }
      }
      if (e.affectsConfiguration(CONFIG_PATHS.historyRetentionDays)) {
        log.info(`History retention updated — ${getClaudeUsageSetting("historyRetentionDays")} days`);
        refreshPanel();
      }
      if (
        e.affectsConfiguration(CONFIG_PATHS.showUsed) ||
        e.affectsConfiguration(CONFIG_PATHS.showSessionResetMarkers) ||
        e.affectsConfiguration(CONFIG_PATHS.showWeeklyResetMarkers) ||
        e.affectsConfiguration(CONFIG_PATHS.showWeeklyForecast) ||
        e.affectsConfiguration(CONFIG_PATHS.showScopedWeeklyLimits)
      ) {
        log.info(`Display settings updated — showUsed: ${getClaudeUsageSetting("showUsed")}`);
        for (const monitor of monitors.values()) {
          monitor.render();
        }
        refreshPanel();
      }
    }),
  );

  // Show the status bar items immediately, then kick off the first refresh.
  log.info(`Activated — refresh interval: ${getClaudeUsageSetting("refreshIntervalSeconds")}s`);
  reconcile();
  void refreshAll();
  startTimer();
}

export function deactivate() {}
