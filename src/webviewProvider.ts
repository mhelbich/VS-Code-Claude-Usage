import * as fs from "fs";
import * as vscode from "vscode";
import type { HistoryEntry } from "./types.js";
import type { HistoryStore } from "./history.js";

export class UsageHistoryProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "claudeUsage.historyView";

  private _view: vscode.WebviewView | undefined;
  private _showUsed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: HistoryStore,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = this._buildHtml(view.webview, this.store.read(), this._showUsed);
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready") {
        view.webview.postMessage({ type: "data", entries: this.store.read(), showUsed: this._showUsed });
      }
    });
  }

  refresh(entries: HistoryEntry[], showUsed: boolean): void {
    this._showUsed = showUsed;
    if (this._view?.visible) {
      this._view.webview.postMessage({ type: "data", entries, showUsed });
    }
  }

  private _buildHtml(webview: vscode.Webview, entries: HistoryEntry[], showUsed: boolean): string {
    const mediaUri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "history-view", file));

    const nonce = getNonce();
    const template = fs.readFileSync(vscode.Uri.joinPath(this.extensionUri, "history-view", "webview.html").fsPath, "utf8");

    return template
      .replaceAll("{{NONCE}}", nonce)
      .replaceAll("{{CSP_SOURCE}}", webview.cspSource)
      .replaceAll("{{CSS_URI}}", mediaUri("webview.css").toString())
      .replaceAll("{{CHART_URI}}", mediaUri("chart.umd.js").toString())
      .replaceAll("{{JS_URI}}", mediaUri("webview.js").toString())
      .replaceAll("{{INITIAL_ENTRIES}}", JSON.stringify(entries))
      .replaceAll("{{INITIAL_SHOW_USED}}", JSON.stringify(showUsed));
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
