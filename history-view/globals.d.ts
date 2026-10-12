// Globals webview.html provides to webview.js, typed for the editor's JavaScript language service.
// acquireVsCodeApi comes from @types/vscode-webview (see jsconfig.json).

/**
 * Chart.js's UMD build (chart.umd.js, the same file as in the chart.js devDependency): the Chart class
 * with the library's other exports, such as Interaction and Tooltip, attached.
 */
declare const Chart: typeof import("chart.js").Chart & typeof import("chart.js");
