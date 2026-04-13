# Changelog

All notable changes to the **Claude Code Usage Status** extension will be documented here.

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
