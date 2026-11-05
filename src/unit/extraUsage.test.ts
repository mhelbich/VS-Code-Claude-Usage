import test from "node:test";
import assert from "node:assert/strict";

import { formatExtraUsage, formatMoney, getExtraUsage } from "../extraUsage";
import { MAX20_SESSION, PRO_EUR_EXTRA, ULTRA_NO_SESSION } from "./usageFixtures";

const eur = (value: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

test("getExtraUsage reads minor units and currency from spend", () => {
  assert.deepEqual(getExtraUsage(PRO_EUR_EXTRA), { enabled: true, usedMinor: 0, limitMinor: 2000, currency: "EUR", exponent: 2 });
});

test("getExtraUsage reports disabled spend", () => {
  assert.deepEqual(getExtraUsage(MAX20_SESSION), { enabled: false });
  assert.deepEqual(getExtraUsage(ULTRA_NO_SESSION), { enabled: false });
});

test("getExtraUsage prefers spend over a contradicting extra_usage", () => {
  assert.deepEqual(getExtraUsage({ ...MAX20_SESSION, extra_usage: { is_enabled: true, monthly_limit: 500, used_credits: 1 } }), { enabled: false });
});

test("getExtraUsage keeps an enabled spend without a limit", () => {
  const extra = getExtraUsage({ spend: { enabled: true, used: { amount_minor: 350, currency: "USD", exponent: 2 }, limit: null } });
  assert.deepEqual(extra, { enabled: true, usedMinor: 350, limitMinor: null, currency: "USD", exponent: 2 });
});

test("getExtraUsage falls back to extra_usage with decimal_places", () => {
  const { spend: _spend, ...legacy } = PRO_EUR_EXTRA;
  assert.deepEqual(getExtraUsage(legacy), { enabled: true, usedMinor: 0, limitMinor: 2000, currency: "EUR", exponent: 2 });
});

test("getExtraUsage falls back to raw extra_usage without decimal_places", () => {
  assert.deepEqual(getExtraUsage({ extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 25, utilization: 25 } }), {
    enabled: true,
    usedMinor: 25,
    limitMinor: 100,
    currency: null,
    exponent: 0,
  });
  assert.deepEqual(getExtraUsage({ extra_usage: { is_enabled: false } }), { enabled: false });
});

test("getExtraUsage returns null when neither field is present", () => {
  assert.equal(getExtraUsage({}), null);
});

test("formatExtraUsage formats money, missing limits, legacy credits, and disabled state", () => {
  assert.equal(formatExtraUsage(getExtraUsage(PRO_EUR_EXTRA)), `${eur(0)} / ${eur(20)}`);
  assert.equal(formatExtraUsage({ enabled: true, usedMinor: 350, limitMinor: null, currency: "EUR", exponent: 2 }), `${eur(3.5)} used`);
  assert.equal(formatExtraUsage({ enabled: true, usedMinor: 25, limitMinor: 100, currency: null, exponent: 0 }), "25 / 100 credits");
  assert.equal(formatExtraUsage({ enabled: false }), "✗ not enabled");
  assert.equal(formatExtraUsage(null), "✗ not enabled");
});

test("formatMoney falls back to a plain number for an invalid currency code", () => {
  assert.equal(formatMoney(1234, "not-a-currency", 2, "en-US"), "12.34");
});
