# Changelog

All notable changes to the **Claude Code Usage Status** extension will be documented here.

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
