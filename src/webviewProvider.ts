import * as fs from "fs";
import * as vscode from "vscode";
import type { HistoryEntry } from "./types.js";
import type { HistoryStore } from "./history.js";
import type { UsageForecast } from "./forecast.js";

export interface HistoryViewSettings {
  showSessionResetMarkers: boolean;
  showWeeklyResetMarkers: boolean;
  showWeeklyForecast: boolean;
  showScopedWeeklyLimits: boolean;
}

/** An account the history panel can show, for its account dropdown. */
export interface HistoryAccountOption {
  key: string;
  label: string;
  active: boolean;
}

export class UsageHistoryProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "claudeUsage.historyView";
  private static readonly ACTIVE_VIEW_KEY = "historyActiveView";
  private static readonly ACTIVE_VIEW_DEFAULT = "current-session";

  private _view: vscode.WebviewView | undefined;
  private _showUsed = false;
  private _forecast: UsageForecast | null = null;
  private _accounts: HistoryAccountOption[] = [];
  private _selectedAccount: string | undefined;
  private _settings: HistoryViewSettings = {
    showSessionResetMarkers: true,
    showWeeklyResetMarkers: true,
    showWeeklyForecast: true,
    showScopedWeeklyLimits: true,
  };

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** The history store of the account the panel shows; changes when another account is selected. */
    private readonly getStore: () => HistoryStore,
    private readonly globalState: vscode.Memento,
    private readonly onSelectAccount: (key: string) => void,
  ) {}

  /**
   * Sets the accounts offered in the panel's dropdown (shown with two or more) and the one shown.
   * Takes effect with the next refresh(), which sends that account's entries.
   */
  setAccounts(accounts: HistoryAccountOption[], selected: string | undefined): void {
    this._accounts = accounts;
    this._selectedAccount = selected;
    this._updateDescription();
  }

  private _updateDescription(): void {
    if (this._view) {
      this._view.description = this._accounts.find((account) => account.key === this._selectedAccount)?.label || undefined;
    }
  }

  private _payload(entries: HistoryEntry[]) {
    return {
      type: "data",
      entries,
      showUsed: this._showUsed,
      settings: this._settings,
      forecast: this._forecast,
      accounts: this._accounts,
      selectedAccount: this._selectedAccount,
    };
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = this._buildHtml(view.webview, this.getStore().read(), this._showUsed, this._settings, this._forecast);
    this._updateDescription();
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready") {
        // Re-send the current payload after the webview scripts are live to avoid dropped early messages.
        view.webview.postMessage(this._payload(this.getStore().read()));
      }
      if (msg?.type === "selectAccount" && this._accounts.some((account) => account.key === msg.key)) {
        this.onSelectAccount(msg.key);
      }
      if (msg?.type === "activeView" && typeof msg.value === "string") {
        this.globalState.update(UsageHistoryProvider.ACTIVE_VIEW_KEY, msg.value);
      }
    });
  }

  refresh(entries: HistoryEntry[], showUsed: boolean, settings: HistoryViewSettings, forecast: UsageForecast | null = this._forecast): void {
    this._showUsed = showUsed;
    this._settings = settings;
    this._forecast = forecast;
    if (this._view?.visible) {
      this._view.webview.postMessage(this._payload(entries));
    }
  }

  private _buildHtml(webview: vscode.Webview, entries: HistoryEntry[], showUsed: boolean, settings: HistoryViewSettings, forecast: UsageForecast | null): string {
    const mediaUri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "history-view", file));

    const nonce = getNonce();
    const template = fs.readFileSync(vscode.Uri.joinPath(this.extensionUri, "history-view", "webview.html").fsPath, "utf8");
    const activeView = this.globalState.get<string>(UsageHistoryProvider.ACTIVE_VIEW_KEY, UsageHistoryProvider.ACTIVE_VIEW_DEFAULT);

    return template
      .replaceAll("{{NONCE}}", nonce)
      .replaceAll("{{CSP_SOURCE}}", webview.cspSource)
      .replaceAll("{{CSS_URI}}", mediaUri("webview.css").toString())
      .replaceAll("{{CHART_URI}}", mediaUri("chart.umd.js").toString())
      .replaceAll("{{JS_URI}}", mediaUri("webview.js").toString())
      .replaceAll("{{INITIAL_ENTRIES}}", JSON.stringify(entries))
      .replaceAll("{{INITIAL_SHOW_USED}}", JSON.stringify(showUsed))
      .replaceAll("{{INITIAL_SETTINGS}}", JSON.stringify(settings))
      .replaceAll("{{INITIAL_FORECAST}}", JSON.stringify(forecast))
      .replaceAll("{{INITIAL_ACTIVE_VIEW}}", JSON.stringify(activeView))
      .replaceAll("{{INITIAL_ACCOUNTS}}", JSON.stringify(this._accounts).replaceAll("<", "\\u003c"))
      .replaceAll("{{INITIAL_SELECTED_ACCOUNT}}", JSON.stringify(this._selectedAccount ?? null).replaceAll("<", "\\u003c"));
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
