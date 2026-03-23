import * as vscode from "vscode";

export const CONFIG_SECTION = "claudeUsage" as const;

/**
 * Interface for the extension's configuration settings.
 */
export interface ClaudeUsageConfiguration {
  refreshIntervalSeconds: number;
  warningThreshold: number;
  dangerThreshold: number;
  showUsed: boolean;
}
export type ClaudeUsageConfigKey = keyof ClaudeUsageConfiguration;

/**
 * Default values for the configuration settings, used when a setting is not defined by the user.
 */
export const CONFIG_DEFAULTS: ClaudeUsageConfiguration = {
  refreshIntervalSeconds: 120,
  warningThreshold: 60,
  dangerThreshold: 90,
  showUsed: false,
};

/**
 * Keys and paths for accessing configuration settings, used throughout the extension to ensure consistency and avoid hardcoding strings.
 */
export const CONFIG_KEYS = {
  refreshIntervalSeconds: "refreshIntervalSeconds",
  warningThreshold: "warningThreshold",
  dangerThreshold: "dangerThreshold",
  showUsed: "showUsed",
} as const satisfies Record<ClaudeUsageConfigKey, ClaudeUsageConfigKey>;

/**
 * Full configuration paths for each setting, combining the section and key, used for listening to configuration changes and accessing settings in a type-safe way.
 */
export const CONFIG_PATHS = {
  refreshIntervalSeconds: `${CONFIG_SECTION}.${CONFIG_KEYS.refreshIntervalSeconds}`,
  warningThreshold: `${CONFIG_SECTION}.${CONFIG_KEYS.warningThreshold}`,
  dangerThreshold: `${CONFIG_SECTION}.${CONFIG_KEYS.dangerThreshold}`,
  showUsed: `${CONFIG_SECTION}.${CONFIG_KEYS.showUsed}`,
} as const satisfies Record<ClaudeUsageConfigKey, `${typeof CONFIG_SECTION}.${ClaudeUsageConfigKey}`>;

/**
 * Commands used by the extension, defined as constants to ensure consistency and avoid hardcoding strings throughout the codebase.
 */
export const COMMANDS = {
  refresh: "claudeUsage.refresh",
} as const;

/**
 * Helper function to get the entire configuration object for the extension, used when multiple settings need to be accessed together or when listening for configuration changes.
 */
export function getClaudeUsageConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/**
 * Helper function to get a specific configuration setting by key, returning the user-defined value or falling back to the default if not set, used throughout the extension whenever a configuration value is needed.
 */
export function getClaudeUsageSetting<K extends ClaudeUsageConfigKey>(key: K): ClaudeUsageConfiguration[K] {
  return getClaudeUsageConfiguration().get<ClaudeUsageConfiguration[K]>(CONFIG_KEYS[key]) ?? CONFIG_DEFAULTS[key];
}
