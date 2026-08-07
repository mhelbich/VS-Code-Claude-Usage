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

export class UsageHistoryProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "claudeUsage.historyView";
  private static readonly ACTIVE_VIEW_KEY = "historyActiveView";
  private static readonly ACTIVE_VIEW_DEFAULT = "current-session";

  private _view: vscode.WebviewView | undefined;
  private _showUsed = false;
  private _forecast: UsageForecast | null = null;
  private _settings: HistoryViewSettings = {
    showSessionResetMarkers: true,
    showWeeklyResetMarkers: true,
    showWeeklyForecast: true,
    showScopedWeeklyLimits: true,
  };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: HistoryStore,
    private readonly globalState: vscode.Memento,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = this._buildHtml(view.webview, this.store.read(), this._showUsed, this._settings, this._forecast);
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready") {
        // Re-send the current payload after the webview scripts are live to avoid dropped early messages.
        view.webview.postMessage({ type: "data", entries: this.store.read(), showUsed: this._showUsed, settings: this._settings, forecast: this._forecast });
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
      this._view.webview.postMessage({ type: "data", entries, showUsed, settings, forecast });
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
      .replaceAll("{{INITIAL_ACTIVE_VIEW}}", JSON.stringify(activeView));
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
