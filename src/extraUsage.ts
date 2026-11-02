import type { UsageResponse } from "./types.js";

export type ExtraUsage =
  | { enabled: false }
  | {
      enabled: true;
      /** Amount spent, in minor units. */
      usedMinor: number;
      /** Monthly limit in minor units, or null if the API reports no limit. */
      limitMinor: number | null;
      /** ISO 4217 code, or null if the API does not report one (legacy responses). */
      currency: string | null;
      /** Minor-unit exponent: value = minor / 10^exponent. */
      exponent: number;
    };

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validExponent(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6 ? value : 0;
}

/**
 * Normalizes extra-usage data. Prefers the structured `spend` object and falls back to the
 * legacy `extra_usage` object. Returns null when the response carries neither.
 */
export function getExtraUsage(usage: UsageResponse): ExtraUsage | null {
  const spend = usage.spend;
  if (spend) {
    if (spend.enabled !== true) return { enabled: false };
    const money = spend.used ?? spend.limit;
    return {
      enabled: true,
      usedMinor: finiteOrNull(spend.used?.amount_minor) ?? 0,
      limitMinor: finiteOrNull(spend.limit?.amount_minor),
      currency: money?.currency || null,
      exponent: validExponent(money?.exponent),
    };
  }

  const extra = usage.extra_usage;
  if (extra) {
    if (extra.is_enabled !== true) return { enabled: false };
    return {
      enabled: true,
      usedMinor: finiteOrNull(extra.used_credits) ?? 0,
      limitMinor: finiteOrNull(extra.monthly_limit),
      currency: extra.currency || null,
      exponent: validExponent(extra.decimal_places),
    };
  }

  return null;
}

/** Formats a minor-unit amount as currency, or as a plain number when the currency is unknown or invalid. */
export function formatMoney(minor: number, currency: string | null, exponent: number, locale?: string): string {
  const value = minor / 10 ** exponent;
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: exponent,
        maximumFractionDigits: exponent,
      }).format(value);
    } catch {
      // Unknown currency code: fall through to the plain number.
    }
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: exponent }).format(value);
}

/** Tooltip text for extra usage, e.g. "€0.00 / €20.00" or "✗ not enabled". */
export function formatExtraUsage(extra: ExtraUsage | null, locale?: string): string {
  if (!extra?.enabled) return "✗ not enabled";
  const unit = extra.currency ? "" : " credits";
  const used = formatMoney(extra.usedMinor, extra.currency, extra.exponent, locale);
  if (extra.limitMinor === null) return `${used}${unit} used`;
  return `${used} / ${formatMoney(extra.limitMinor, extra.currency, extra.exponent, locale)}${unit}`;
}
