// Runs before every tsc build:
// 1. Clears out/, because tsc never deletes output for removed sources (stale tests would keep running).
// 2. Copies Chart.js's UMD build into history-view/. The webview can only load scripts that ship
//    inside the extension (CSP + node_modules is excluded from the VSIX), so the file the lockfile
//    pins is copied on each build instead of being committed.
import { copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

rmSync(join(root, "out"), { recursive: true, force: true });
copyFileSync(join(root, "node_modules", "chart.js", "dist", "chart.umd.js"), join(root, "history-view", "chart.umd.js"));
