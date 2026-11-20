import { ema } from '../core/math.js';

const ATR_PERIOD = 14;
const PIVOT_BARS = 2;
const SWING_BUFFER = 0.12;
const SWING_BUFFER_ATR = 0.25;
const MIN_RISK_ATR = 1.25;
const MAX_RISK_ATR = 3.2;
const TREND_PERIOD = 100;
const SLOPE_LOOKBACK = 5;
const MIN_BODY_ATR = 0.30;
const MIN_CLOSE_POS = 0.58;
const SIGNAL_COOLDOWN = 5;

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

// 结构性防插针止损：摆动点外侧附加自适应 ATR 缓冲并限幅，同时维持 1R / 2R 盈亏比结构。
function setupPrices(i, dir, entry, atr, pivots) {
  const swing = dir > 0 ? pivots.low : pivots.high;
  const buffer = Math.max(SWING_BUFFER, atr * SWING_BUFFER_ATR);
  const swingRisk = swing == null ? 0 : dir * (entry - swing) + buffer;
  const risk = Math.min(atr * MAX_RISK_ATR, Math.max(atr * MIN_RISK_ATR, swingRisk));
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
    const body = Math.abs(bar.c - bar.o);
    const range = Math.max(1e-6, bar.h - bar.l);
    if (atr <= 0 || body < atr * MIN_BODY_ATR) continue;

    const deviation = bar.c - trend[i];
    if (Math.abs(deviation) < atr) continue;

    const dir = Math.sign(deviation);
    // 要求 K 线实体与突破方向一致且强收盘，过滤长反向影线假突破
    if (dir * (bar.c - bar.o) <= 0) continue;
    const closePos = dir > 0 ? (bar.c - bar.l) / range : (bar.h - bar.c) / range;
    if (closePos < MIN_CLOSE_POS) continue;

    // 均线斜率过滤：避免欧美盘价格围绕 EMA100 横向拉锯时反复打脸
    const trendSlope = trend[i] - trend[Math.max(0, i - SLOPE_LOOKBACK)];
    if (dir * trendSlope < 0) continue;

    const prevAtr = averageTrueRange(klines, i - 1);
    const prevDeviation = klines[i - 1].c - trend[i - 1];
    if (dir * prevDeviation > 0 && dir * prevDeviation >= prevAtr) continue;

    // 信号冷却期：抑制围绕阈值来回洗单
    if (setups.length && (i - setups[setups.length - 1].i) <= SIGNAL_COOLDOWN) continue;

    setups.push(setupPrices(i, dir, bar.c, atr, pivots));
  }
  return setups;
}
