import * as vscode from "vscode";
import type { Account } from "./accounts";
import { fetchUsage } from "./api";
import { readCache, writeCache } from "./cache";
import { COMMANDS, getClaudeUsageSetting } from "./config";
import { withAccountSuffix } from "./configDir";
import { getAccessToken } from "./credentials";
import { EMPTY_FORECAST_PROFILE, updateForecastProfile, type ForecastProfile, type UsageForecast } from "./forecast";
import { getHistoryFileName, HistoryStore } from "./history";
import { refreshUsage, type RefreshLog } from "./refresh";
import { forecastStateToBarProps, reduce, stateToBarProps, type Action, type BarProps, type State } from "./statusBar";
import type { ColorThresholds } from "./types";

export function applyProps(props: BarProps, bar: vscode.StatusBarItem): void {
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

export interface AccountMonitorEnvironment {
  globalStorageUri: vscode.Uri;
  globalState: vscode.Memento;
  log: vscode.LogOutputChannel;
  /** Called after this account's usage or history changed, so the history panel can redraw if it shows it. */
  onHistoryChanged: (monitor: AccountMonitor) => void;
}

function currentThresholds(): ColorThresholds {
  return { warning: getClaudeUsageSetting("warningThreshold"), danger: getClaudeUsageSetting("dangerThreshold") };
}

/**
 * One monitored account: its status bar items, usage state, history and weekly forecast profile.
 * The config dir is fixed for the monitor's lifetime; a different dir gets a new monitor, so a refresh
 * can never land in another account's state.
 */
export class AccountMonitor {
  readonly key: string;
  readonly configDir: string | undefined;
  readonly history: HistoryStore;

  private account: Account;
  private index: number;
  private state: State = { kind: "loading" };
  private forecastProfile: ForecastProfile;
  private bar: vscode.StatusBarItem;
  private forecastBar: vscode.StatusBarItem;
  private disposed = false;

  constructor(
    account: Account,
    index: number,
    private readonly env: AccountMonitorEnvironment,
  ) {
    this.account = account;
    this.index = index;
    this.key = account.key;
    this.configDir = account.configDir;
    this.history = new HistoryStore(
      () => vscode.Uri.joinPath(env.globalStorageUri, getHistoryFileName(this.configDir)).fsPath,
      (msg) => this.log.warn(msg),
      () => getClaudeUsageSetting("historyRetentionDays"),
    );
    [this.bar, this.forecastBar] = this.createItems();
    this.forecastProfile = this.loadForecastProfile();
    this.render();
  }

  get label(): string | undefined {
    return this.account.label;
  }

  get active(): boolean {
    return this.account.active;
  }

  /** The weekly forecast of the last successful refresh, for the history panel. */
  get forecast(): UsageForecast | null {
    return this.state.kind === "ok" ? (this.state.forecast ?? null) : null;
  }

  private get forecastProfileKey(): string {
    return withAccountSuffix("weeklyForecastProfile.v1", this.configDir);
  }

  private get log(): RefreshLog {
    const prefix = () => (this.account.label ? `[${this.account.label}] ` : "");
    return {
      debug: (msg) => this.env.log.debug(prefix() + msg),
      info: (msg) => this.env.log.info(prefix() + msg),
      warn: (msg) => this.env.log.warn(prefix() + msg),
      error: (msg) => this.env.log.error(prefix() + msg),
    };
  }

  private readonly onIncompleteForecastWeek = (reset: number, sampleCount: number): void => {
    this.log.debug(`Weekly forecast profile: dropping week ending ${new Date(reset).toISOString()} — only ${sampleCount} usable sample(s), not enough coverage to learn from`);
  };

  private loadForecastProfile(): ForecastProfile {
    const profile = updateForecastProfile(
      this.env.globalState.get<ForecastProfile>(this.forecastProfileKey) ?? EMPTY_FORECAST_PROFILE,
      this.history.read(),
      undefined,
      this.onIncompleteForecastWeek,
    );
    void this.env.globalState.update(this.forecastProfileKey, profile);
    return profile;
  }

  private createItems(): [vscode.StatusBarItem, vscode.StatusBarItem] {
    // The default config dir keeps the original ids, so items users already hid stay hidden.
    // Right-aligned items with a higher priority sit further left, so accounts appear in list order.
    const bar = vscode.window.createStatusBarItem(withAccountSuffix("claudeUsage.main", this.configDir), vscode.StatusBarAlignment.Right, 100 - 2 * this.index);
    bar.command = COMMANDS.refresh;
    const forecastBar = vscode.window.createStatusBarItem(
      withAccountSuffix("claudeUsage.forecast", this.configDir),
      vscode.StatusBarAlignment.Right,
      99 - 2 * this.index,
    );
    forecastBar.command = COMMANDS.refresh;
    this.nameItems(bar, forecastBar);
    return [bar, forecastBar];
  }

  private nameItems(bar: vscode.StatusBarItem, forecastBar: vscode.StatusBarItem): void {
    const suffix = this.account.label ? ` (${this.account.label})` : "";
    bar.name = `Claude Usage${suffix}`;
    forecastBar.name = `Claude Usage Forecast${suffix}`;
  }

  /** Applies a new label, active flag or position from the account list. */
  update(account: Account, index: number): void {
    this.account = account;
    if (index !== this.index) {
      // A status bar item's priority is fixed at creation.
      this.index = index;
      this.bar.dispose();
      this.forecastBar.dispose();
      [this.bar, this.forecastBar] = this.createItems();
    } else {
      this.nameItems(this.bar, this.forecastBar);
    }
    this.render();
  }

  /** Re-applies the status bar items after a display setting changed. */
  render(): void {
    if (this.disposed) {
      return;
    }
    const showUsed = getClaudeUsageSetting("showUsed");
    const display = { label: this.account.label, icon: this.account.active };
    applyProps(stateToBarProps(this.state, showUsed, getClaudeUsageSetting("showScopedWeeklyLimits"), display), this.bar);
    applyProps(forecastStateToBarProps(this.state, showUsed), this.forecastBar);
  }

  private dispatch(action: Action): void {
    if (this.disposed) {
      return;
    }
    this.state = reduce(this.state, action);
    this.render();
  }

  thresholdsChanged(thresholds: ColorThresholds): void {
    this.dispatch({ type: "thresholds-changed", thresholds });
  }

  refresh(force = false): Promise<void> {
    return refreshUsage(
      {
        getConfigDir: () => this.configDir,
        readCache,
        writeCache,
        getAccessToken,
        fetchUsage,
        getForecastProfile: () => this.forecastProfile,
        saveForecastProfile: (profile) => {
          this.forecastProfile = profile;
          return this.env.globalState.update(this.forecastProfileKey, profile);
        },
        appendHistory: (entry) => this.history.append(entry),
        showUsage: (usage, forecast) => {
          this.dispatch({ type: "fetch-success", usage, forecast, thresholds: currentThresholds() });
          this.notifyHistoryChanged();
        },
        showLastKnown: (cached) => {
          this.dispatch({ type: "last-known", usage: cached.data, fetchedAt: cached.fetchedAt, thresholds: currentThresholds() });
          this.notifyHistoryChanged();
        },
        dispatch: (action) => this.dispatch(action),
        getRefreshIntervalSeconds: () => getClaudeUsageSetting("refreshIntervalSeconds"),
        onIncompleteForecastWeek: this.onIncompleteForecastWeek,
        log: this.log,
        now: () => Date.now(),
      },
      force,
    );
  }

  private notifyHistoryChanged(): void {
    if (!this.disposed) {
      this.env.onHistoryChanged(this);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.bar.dispose();
    this.forecastBar.dispose();
  }
}
