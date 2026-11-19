import { ema } from '../core/math.js';

const ATR_PERIOD = 14;
const PIVOT_BARS = 2;
const SWING_BUFFER = 0.12;
const TREND_PERIOD = 100;
const MIN_BODY_ATR = 0.25;

export const XAUDZ_MIN_BARS = TREND_PERIOD;

function averageTrueRange(klines, i) {
  let sum = 0;
  for (let j = i - ATR_PERIOD + 1; j <= i; j++) {
    const { h, l } = klines[j];
    const previousClose = klines[j - 1].c;
    sum += Math.max(h - l, Math.abs(h - previousClose), Math.abs(l - previousClose));
  }
  return sum / ATR_PERIOD;
}

function confirmedPivots(klines, i, pivots) {
  const pivot = klines[i];
  let high = true;
  let low = true;
  for (let j = 1; j <= PIVOT_BARS; j++) {
    const left = klines[i - j];
    const right = klines[i + j];
    high = high && pivot.h > left.h && pivot.h > right.h;
    low = low && pivot.l < left.l && pivot.l < right.l;
  }
  if (high) pivots.high = pivot.h;
  if (low) pivots.low = pivot.l;
}

// This risk rule reproduces the sampled MT4 stop and first target prices.
function setupPrices(i, dir, entry, atr, pivots) {
  const swing = dir > 0 ? pivots.low : pivots.high;
  const swingRisk = swing == null ? 0 : dir * (entry - swing) + SWING_BUFFER;
  const risk = Math.max(atr, swingRisk);
  return {
    i,
    dir,
    entry,
    sl: entry - dir * risk,
    tp1: entry + dir * risk,
    tp2: entry + dir * risk * 2,
    atr,
  };
}

export function findXaudzSetups(klines, end) {
  const closedCount = Math.min(klines.length, end + 1);
  if (closedCount < XAUDZ_MIN_BARS) return [];

  const trend = ema(klines.slice(0, closedCount).map((bar) => bar.c), TREND_PERIOD);
  const setups = [];
  const pivots = { high: null, low: null };
  for (let i = PIVOT_BARS * 2; i < closedCount; i++) {
    confirmedPivots(klines, i - PIVOT_BARS, pivots);
    if (i < XAUDZ_MIN_BARS - 1) continue;

    const bar = klines[i];
    const atr = averageTrueRange(klines, i);
    if (atr <= 0 || Math.abs(bar.c - bar.o) < atr * MIN_BODY_ATR) continue;

    // The entry trigger approximates the original indicator using the available signal samples.
    const deviation = bar.c - trend[i];
    if (Math.abs(deviation) < atr) continue;

    const dir = Math.sign(deviation);
    const prevAtr = averageTrueRange(klines, i - 1);
    const prevDeviation = klines[i - 1].c - trend[i - 1];
    if (dir * prevDeviation > 0 && dir * prevDeviation >= prevAtr) continue;
    setups.push(setupPrices(i, dir, bar.c, atr, pivots));
  }
  return setups;
}
