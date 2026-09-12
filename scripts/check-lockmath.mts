/**
 * Runs the pure schedule arithmetic the site renders — phases, fractions,
 * countdowns, the rule preview — in Node, with no browser in the loop.
 *
 *   npm run check:lockmath
 */
import assert from "node:assert/strict";
import { countdown, feePhase, formatDuration, formatSpan, fraction, previewRule, ratio, trimEth, vestPhase, weiToEth, type FeeLockJson, type LockStatusJson } from "../src/lib/lockmath.ts";

const DAY = 86_400;
const T0 = 1_800_000_000;

const fees = (over: Partial<FeeLockJson> = {}): FeeLockJson => ({
  armed: true,
  graduated: false,
  graduatedLive: false,
  graduatedAt: 0,
  deadline: T0 + 14 * DAY,
  vestEnd: 0,
  buried: false,
  buryable: "0",
  nextBuryAt: 0,
  pending: "0",
  balance: "0",
  releasable: "0",
  locked: "0",
  totalReceived: "0",
  totalReleased: "0",
  totalBuried: "0",
  tokensBurned: "0",
  ...over,
});

// ── phases ──────────────────────────────────────────────────────────────
assert.equal(feePhase(fees(), T0 + DAY), "locked");
assert.equal(feePhase(fees(), T0 + 14 * DAY - 1), "locked");
assert.equal(feePhase(fees(), T0 + 14 * DAY), "buriable");
assert.equal(feePhase(fees({ graduatedLive: true }), T0 + DAY), "checkpoint");
assert.equal(feePhase(fees({ graduatedLive: true }), T0 + 20 * DAY), "checkpoint", "a late checkpoint still beats a burial");
assert.equal(feePhase(fees({ graduated: true, graduatedLive: true, graduatedAt: T0 + DAY, vestEnd: T0 + 31 * DAY }), T0 + 10 * DAY), "unlocking");
assert.equal(feePhase(fees({ graduated: true, graduatedLive: true, graduatedAt: T0 + DAY, vestEnd: T0 + 31 * DAY }), T0 + 31 * DAY), "open");
assert.equal(feePhase(fees({ buried: true }), T0 + 40 * DAY), "buried");
assert.equal(feePhase(fees({ buried: true, graduatedLive: true }), T0 + 40 * DAY), "buried", "a burial ignores a later graduation");

const locks = (over: Partial<LockStatusJson> = {}): LockStatusJson => ({
  fees: fees(),
  hasVesting: true,
  vestStart: T0,
  vestEnd: T0 + 90 * DAY,
  devAllocation: "1000",
  devReleased: "0",
  devReleasable: "0",
  devLocked: "1000",
  ...over,
});
assert.equal(vestPhase(locks({ hasVesting: false }), T0), "none");
assert.equal(vestPhase(locks(), T0 + 45 * DAY), "vesting");
assert.equal(vestPhase(locks(), T0 + 90 * DAY), "done");

// ── fractions and formatting ────────────────────────────────────────────
assert.equal(fraction(T0 - 1, T0, T0 + 100), 0);
assert.equal(fraction(T0 + 25, T0, T0 + 100), 0.25);
assert.equal(fraction(T0 + 100, T0, T0 + 100), 1);
assert.equal(fraction(T0 + 5, T0, T0), 1, "a zero-length window is over once reached");
assert.equal(fraction(T0 - 5, T0, T0), 0);

assert.equal(formatDuration(0), "0");
assert.equal(formatDuration(30), "<1m");
assert.equal(formatDuration(59 * 60), "59m");
assert.equal(formatDuration(3 * 3600 + 12 * 60), "3h 12m");
assert.equal(formatDuration(12 * DAY + 4 * 3600 + 59 * 60), "12d 04h");
assert.equal(countdown(T0 + 10, T0 + 20), "0", "never negative");
assert.equal(formatSpan(90 * DAY), "90 days");
assert.equal(formatSpan(DAY), "1 day");
assert.equal(formatSpan(3600), "1 hour");

assert.equal(weiToEth("1500000000000000000", 4), "1.5000");
assert.equal(weiToEth("1", 5), "0.00000");
assert.equal(weiToEth(10n ** 18n, 0), "1");
assert.equal(ratio("250", "1000"), 0.25);
assert.equal(ratio("1", "0"), 0);
assert.equal(trimEth("0.0500"), "0.05");
assert.equal(trimEth("1.000"), "1");
assert.equal(trimEth(""), "0");
assert.equal(trimEth("abc"), "0");

// ── the rule preview ────────────────────────────────────────────────────
const withDev = previewRule({ devBuyEth: "0.05", vestDays: 90, windowDays: 14, feeVestDays: 30, launchAt: T0, padSharePct: 10 });
assert.equal(withDev.length, 4);
assert.match(withDev[0].text, /0\.05 ETH developer buy/);
assert.match(withDev[0].text, /over 90 days/);
assert.match(withDev[2].text, /IF the curve graduates/);
assert.match(withDev[2].text, /pays you 90%, the pad 10%/);
assert.match(withDev[3].text, /IF the curve has not graduated by/);
assert.match(withDev[3].text, /Nobody is paid/);

const noDev = previewRule({ devBuyEth: "", vestDays: 90, windowDays: 7, feeVestDays: 30, launchAt: T0, padSharePct: 10 });
assert.match(noDev[0].text, /No developer buy/);
assert.match(noDev[0].text, /pays the snipe tax/);

// The deadline in the preview is exactly launch + window.
const d = new Date((T0 + 7 * DAY) * 1000);
const expectDay = d.getUTCDate();
assert.ok(noDev[3].text.includes(String(expectDay)), `deadline day ${expectDay} in: ${noDev[3].text}`);

console.log("lockmath: all checks pass");
