# Changelog

All notable changes to the **Claude Code Usage Status** extension will be documented here.

## [0.3.2] - 2026-08-07

### Changed

- Replaced the continuously linear weekly forecast with a regularized baseline that avoids extreme projections immediately after reset and gradually incorporates recent personal weekly usage patterns.
- Status bar, tooltip, and Usage History now share one forecast engine and consistently label whether a baseline or personalized forecast is being shown.
- Forecast learning is stored separately from chart history, so changing history retention no longer changes the learned forecast profile.

### Maintenance

- Weekly forecast profile now logs at debug level when a week's usage data is dropped for insufficient coverage, aiding diagnosis.
- CI now runs on Node 24.x with `npm ci`, cancels superseded runs on the same ref, and supports manual `workflow_dispatch` triggers.
- Bumped dependencies: `js-yaml`, `fast-uri`, `undici`, `linkify-it`, `brace-expansion`, `@vscode/test-electron`, `@types/node`, and `actions/setup-node`.

## [0.3.1] - 2026-07-02

### Added

- Model-specific weekly limits returned by the usage API, such as Fable, are shown dynamically in the tooltip and Usage History panel.
- Added `showScopedWeeklyLimits`, enabled by default, to hide model-specific weekly limit displays while continuing to record their history.

### Removed

- Removed the obsolete fixed Opus 7-day tooltip and history series.

## [0.3.0] - 2026-06-25

### Added

- **Usage History overlays** — session-start markers, weekly reset markers, ideal weekly pace line, and weekly forecast projection in the history chart; each overlay can be toggled independently via new settings and in-panel checkboxes
- **Weekly forecast** — projection toward the next weekly reset shown in the history panel, tooltip, and as a separate color-coded status bar dot; warns if the current pace is on track to hit the limit early; the status bar item can be hidden via right-click → "Claude Usage Forecast"
- **Tooltip forecast markers** — usage bars in the hover tooltip now include a forecast marker showing projected utilization at reset
- **History navigation** — quick-select buttons for current session, current week, and today alongside fixed-range buttons (1h, 6h, 1d, 7d, 30d); the selected view persists across panel reloads
- **New settings** — `showSessionResetMarkers`, `showWeeklyResetMarkers`, and `showWeeklyForecast` to control history overlay defaults

### Fixed

- History chart reset lines are now broken at session and weekly reset boundaries instead of drawing a diagonal line back up to 100% across the chart; idle periods between sessions are hidden to reduce noise
- History panel no longer causes a vertical scroll — the chart now uses flex layout to fill the available height dynamically, so the added weekly forecast summary row no longer pushes the panel past 100vh
- Tooltip position and data are now correct — replaced the built-in `index` interaction mode with a custom per-dataset nearest-x lookup so forecast lines (25 sample points) no longer corrupt the array-index lookup into session data (100+ points); a `clampedAverage` positioner additionally prevents off-canvas forecast points from pulling the tooltip toward the left edge

### Maintenance

- Bumped dev toolchain (`@vscode/test-cli`, `@vscode/test-electron`, `@vscode/vsce`, `@types/node`) and GitHub Actions; updated transitive deps (`undici`, `markdown-it`, `form-data`, `js-yaml`)

## [0.2.8] - 2026-06-03

### Fixed

- Status bar no longer flickers during refresh — existing data is kept visible while new data loads, switching to the loading indicator only on initial load or after an error.

## [0.2.7] - 2026-06-01

### Maintenance

- npm packages maintenance.

## [0.2.6] - 2026-05-13

### Maintenance

- Bumped dev dependencies: `fast-uri`, `@types/node`, and `@vscode/vsce` to latest versions.

## [0.2.5] - 2026-04-21

### Maintenance

- Added an icon for the extension - because icons are cool.

## [0.2.4] - 2026-04-15

### Fixed

- **Tooltip bar was not inverted when showing used percentage** — the HTML bar always rendered remaining capacity as the colored portion, ignoring the `showUsed` setting. The bar now visually matches the displayed metric: colored blocks represent used % when `showUsed` is enabled, remaining % otherwise.

### Maintenance

- CI/CD Github Read-only token permissions
- Bumped `@vscode/vsce`

## [0.2.3] - 2026-04-13

### Fixed

- **History chart x-axis was not anchored to the expected time range** — the chart now sets explicit min/max bounds on the x-axis based on the selected time range cutoff and the current time, preventing Chart.js from auto-scaling to the data points and misrepresenting gaps at the edges.
- **Improved error handling in `fetchUsage`** — invalid or unexpected API responses are now caught earlier and surfaced with clearer messages rather than propagating as hard-to-diagnose downstream errors.

### Maintenance

- Updated User-Agent header to reflect current Claude Code version (`2.1.104`).
- Fixed missing `types` configuration in `tsconfig.json` and test suite import for proper Mocha type resolution.
- Bumped `@types/node` from `22.19.15` to `22.19.17`.

## [0.2.2] - 2026-04-01

### Fixed

- **History graph showed no data on first open** — a race condition between the extension's async refresh and the webview's JavaScript initialization caused `postMessage` updates to be silently dropped if they arrived before the message listener was registered. The webview now sends a `ready` signal once its scripts are loaded, and the extension re-sends the current history in response, guaranteeing the chart always reflects up-to-date data regardless of timing.
- **Data points were evenly spaced on the x-axis regardless of actual time between them** — the chart was using Chart.js's default `category` scale, which treats each point as equidistant. Switched to a `linear` scale with timestamp values so a manual refresh 2 minutes into a 5-minute interval is rendered at the correct relative position. Tooltip titles are also formatted as human-readable dates rather than raw timestamps.

## [0.2.1] - 2026-03-25

### Fixed

- **Refresh interval was effectively doubled** — the cache timestamp was recorded after the async API call completed rather than when the refresh started. This meant the next timer tick (exactly `refreshIntervalSeconds` later) saw a cache that was a few hundred milliseconds shy of the threshold and skipped the fetch. Every other tick was silently skipped, doubling the actual interval (e.g. a 5-minute setting behaved like 10 minutes).

## [0.2.0] - 2026-03-24

### Added

- **Usage History panel** — a new panel in the bottom area (alongside Terminal/Output) displaying a time-series chart of all four usage buckets: 5-hour session, 7-day weekly, Opus 7-day, and extra credits
- Dual y-axis chart: percentage metrics on the left, extra credits on the right (auto-scaled to monthly limit)
- Time range buttons to filter the chart: 1h, 6h, 1d, 7d, 30d
- Chart respects the `showUsed` setting — toggles between used % and remaining % on the fly
- New `claudeUsage.historyRetentionDays` setting (default: 30 days) to control how much history is kept
- History persisted to a local JSON file in VS Code's global storage — no sync, no cloud

## [0.1.3] - 2026-03-23

### Added

- New `claudeUsage.showUsed` setting to display used % instead of remaining % in the status bar and tooltip

### Fixed

- Manual refresh now bypasses the cache, ensuring up-to-date data on demand

## [0.1.2] - 2026-03-23

### Added

- API response caching to reduce redundant requests and optimize usage checks across multiple VS Code instances
- Enhanced logging for API usage fetching and cache management

## [0.1.1] - 2026-03-17

### Added

- State management for status bar updates to prevent unnecessary redraws
- Unit tests for status bar logic

### Fixed

- Status bar background color now resets correctly before each update

## [0.1.0] - 2026-03-16

### Added

- Initial release
- Status bar item showing Claude Code session and weekly token usage
- Color-coded thresholds: yellow (warning) and red (danger)
- Configurable refresh interval, warning threshold, and danger threshold
- Manual refresh command (`Claude Usage: Refresh Now`)
