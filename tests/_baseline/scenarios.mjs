/**
 * 基线场景定义。record.mjs 与 verify.mjs 共享，保证两次跑的输入逐字节一致。
 *
 * 时间戳一律用固定的过去时刻，这样 klinesClosed / pbClosedEnd / hkldClosedEnd
 * 都会判定"全部已收盘"，输出不受运行时刻影响。
 * 代价：基线不覆盖"最后一根未收盘"的路径 —— 那条路径依赖 Date.now()，
 * 无法在快照里固定。改动 B3 相关代码时需要另外用 CDP 交互测试覆盖。
 */

import { randomWalkOHLC } from '../_lib/rw.mjs';

/** 2023-11-14 22:13:20 UTC，远早于任何运行时刻。 */
export const T0 = 1_700_000_000;

const STEP = { '10s': 10, '1m': 60, '5m': 300, '15m': 900, '1h': 3600 };

export function stepOf(tf) {
  return STEP[tf] || 60;
}

/** 让最后一根的收盘时刻落在 T0，序列整体向前推。 */
function barsFor(spec) {
  const step = stepOf(spec.tf);
  return randomWalkOHLC({
    n: spec.n,
    seed: spec.seed,
    start: spec.start != null ? spec.start : 2650,
    vol: spec.vol,
    drift: spec.drift || 0,
    mode: spec.mode || 'cont',
    gapNoise: spec.gapNoise != null ? spec.gapNoise : 0.02,
    t0: T0 - spec.n * step,
    step: step,
  });
}

/**
 * 单周期场景：走 __goldTest.applyKlines，取回 trap/hold/smc/stack/hkld/fib/judge。
 * vol 参照真实 1m 黄金 ATR14 量级（0.6~2.7 美元）标定。
 */
export const KLINE_SCENARIOS = [
  { id: '1m-vol-low', tf: '1m', n: 180, seed: 1011, vol: 0.20 },
  { id: '1m-vol-mid', tf: '1m', n: 180, seed: 1022, vol: 0.45 },
  { id: '1m-vol-high', tf: '1m', n: 180, seed: 1033, vol: 0.95 },
  { id: '1m-trend-up', tf: '1m', n: 180, seed: 1044, vol: 0.45, drift: 0.05 },
  { id: '1m-trend-dn', tf: '1m', n: 180, seed: 1055, vol: 0.45, drift: -0.05 },
  { id: '1m-trend-strong-up', tf: '1m', n: 180, seed: 1066, vol: 0.30, drift: 0.12 },
  { id: '1m-gap', tf: '1m', n: 180, seed: 1077, vol: 0.45, mode: 'gap', gapNoise: 0.06 },
  { id: '1m-gap-wide', tf: '1m', n: 180, seed: 1088, vol: 0.45, mode: 'gap', gapNoise: 0.30 },
  { id: '1m-n360', tf: '1m', n: 360, seed: 1099, vol: 0.45 },
  { id: '1m-n480', tf: '1m', n: 480, seed: 1100, vol: 0.45 },
  { id: '1m-tiny', tf: '1m', n: 15, seed: 1111, vol: 0.45 },
  { id: '1m-short', tf: '1m', n: 40, seed: 1122, vol: 0.45 },
  { id: '5m-mid', tf: '5m', n: 180, seed: 2011, vol: 0.90 },
  { id: '5m-trend-up', tf: '5m', n: 180, seed: 2022, vol: 0.90, drift: 0.10 },
  { id: '15m-mid', tf: '15m', n: 180, seed: 3011, vol: 1.60 },
  { id: '1h-mid', tf: '1h', n: 180, seed: 4011, vol: 3.20 },
  { id: '10s-mid', tf: '10s', n: 180, seed: 5011, vol: 0.12 },
  { id: '10s-trend-up', tf: '10s', n: 180, seed: 5022, vol: 0.12, drift: 0.02 },
];

export function klinesFor(scenario) {
  return barsFor(scenario);
}

/**
 * 多周期场景：走 applyStack / applyHkld，注入 1m/5m/15m/1h。
 * 各层独立生成，只要求确定性与分支覆盖，不追求"同一段行情的不同周期视图"。
 */
export const MTF_SCENARIOS = [
  {
    id: 'stack-aligned-up',
    kind: 'stack',
    tf: '1m',
    layers: {
      '1m': { n: 180, seed: 6011, vol: 0.45, drift: 0.04 },
      '5m': { n: 120, seed: 6012, vol: 0.90, drift: 0.08 },
      '15m': { n: 90, seed: 6013, vol: 1.60, drift: 0.15 },
      '1h': { n: 80, seed: 6014, vol: 3.20, drift: 0.30 },
    },
  },
  {
    id: 'stack-aligned-dn',
    kind: 'stack',
    tf: '1m',
    layers: {
      '1m': { n: 180, seed: 6021, vol: 0.45, drift: -0.04 },
      '5m': { n: 120, seed: 6022, vol: 0.90, drift: -0.08 },
      '15m': { n: 90, seed: 6023, vol: 1.60, drift: -0.15 },
      '1h': { n: 80, seed: 6024, vol: 3.20, drift: -0.30 },
    },
  },
  {
    id: 'stack-conflict',
    kind: 'stack',
    tf: '1m',
    layers: {
      '1m': { n: 180, seed: 6031, vol: 0.45, drift: 0.06 },
      '5m': { n: 120, seed: 6032, vol: 0.90, drift: 0.10 },
      '15m': { n: 90, seed: 6033, vol: 1.60, drift: -0.18 },
      '1h': { n: 80, seed: 6034, vol: 3.20, drift: -0.35 },
    },
  },
  {
    id: 'stack-quiet',
    kind: 'stack',
    tf: '1m',
    layers: {
      '1m': { n: 180, seed: 6041, vol: 0.10 },
      '5m': { n: 120, seed: 6042, vol: 0.18 },
      '15m': { n: 90, seed: 6043, vol: 0.30 },
      '1h': { n: 80, seed: 6044, vol: 0.60 },
    },
  },
  {
    id: 'hkld-htf-up',
    kind: 'hkld',
    tf: '1m',
    layers: {
      '1m': { n: 180, seed: 7011, vol: 0.45, drift: 0.03 },
      '5m': { n: 120, seed: 7012, vol: 0.90, drift: 0.06 },
      '15m': { n: 90, seed: 7013, vol: 1.60, drift: 0.12 },
      '1h': { n: 80, seed: 7014, vol: 3.20 },
    },
  },
  {
    id: 'hkld-htf-dn',
    kind: 'hkld',
    tf: '1m',
    layers: {
      '1m': { n: 180, seed: 7021, vol: 0.45, drift: -0.03 },
      '5m': { n: 120, seed: 7022, vol: 0.90, drift: -0.06 },
      '15m': { n: 90, seed: 7023, vol: 1.60, drift: -0.12 },
      '1h': { n: 80, seed: 7024, vol: 3.20 },
    },
  },
  {
    id: 'hkld-htf-short',
    kind: 'hkld',
    tf: '1m',
    layers: {
      '1m': { n: 180, seed: 7031, vol: 0.45 },
      '5m': { n: 20, seed: 7032, vol: 0.90 },
      '15m': { n: 12, seed: 7033, vol: 1.60 },
      '1h': { n: 8, seed: 7034, vol: 3.20 },
    },
  },
];

export function mtfPackFor(scenario) {
  const pack = { tf: scenario.tf };
  Object.keys(scenario.layers).forEach((tf) => {
    const spec = scenario.layers[tf];
    pack[tf] = barsFor({
      tf: tf,
      n: spec.n,
      seed: spec.seed,
      vol: spec.vol,
      drift: spec.drift || 0,
      mode: spec.mode || 'cont',
      start: spec.start,
    });
  });
  pack.klines = pack[scenario.tf] || pack['1m'];
  return pack;
}

/** RSI 周期回归：A7 修过周期分裂，这里锁住三个周期各自的输出。 */
export const RSI_PERIODS = [6, 9, 14];

export const RSI_SCENARIO = { id: 'rsi-sweep', tf: '1m', n: 180, seed: 8011, vol: 0.45 };

/** 快单信号：evalFastSetup 需要 10 秒棒 + ticker。 */
export const FAST_SCENARIOS = [
  { id: 'fast-quiet', n: 180, seed: 9011, vol: 0.12, spread: 0.10 },
  { id: 'fast-trend-up', n: 180, seed: 9022, vol: 0.12, drift: 0.02, spread: 0.10 },
  { id: 'fast-trend-dn', n: 180, seed: 9033, vol: 0.12, drift: -0.02, spread: 0.10 },
  { id: 'fast-wide-spread', n: 180, seed: 9044, vol: 0.12, spread: 0.90 },
  { id: 'fast-no-book', n: 180, seed: 9055, vol: 0.12, spread: null },
];

export function fastBarsFor(scenario) {
  return barsFor({ tf: '10s', n: scenario.n, seed: scenario.seed, vol: scenario.vol, drift: scenario.drift || 0 });
}

export function fastTickerFor(scenario, bars) {
  const last = bars[bars.length - 1];
  const half = scenario.spread == null ? null : scenario.spread / 2;
  return {
    last: last.c,
    bid: half == null ? null : last.c - half,
    ask: half == null ? null : last.c + half,
    high: Math.max.apply(null, bars.map((b) => b.h)),
    low: Math.min.apply(null, bars.map((b) => b.l)),
    status: 'open',
  };
}

/** 纯函数探针：固定输入，锁住解析与格式化口径。 */
export const SPREAD_PROBES = [
  [null, 1.8], [0, 1.8], [0.05, 1.8], [0.28, 1.8], [0.5, 1.8], [0.504, 1.8],
  [0.6, 1.8], [0.9, null], [0.79, null], [0.81, null], [1.2, 0.55], [0.1, 0.4],
];

export const RSI_SERIES_PROBE = {
  closes: [
    2650.0, 2650.4, 2649.8, 2651.2, 2652.0, 2651.5, 2653.1, 2654.0, 2653.2, 2652.8,
    2654.5, 2655.9, 2655.1, 2656.4, 2657.0, 2656.2, 2655.0, 2653.9, 2654.8, 2656.1,
    2657.3, 2658.0, 2657.1, 2655.8, 2654.2, 2653.0, 2654.1, 2655.5, 2656.8, 2658.2,
  ],
  periods: [6, 9, 14],
};

export const TICKER_PROBES = [
  { label: 'cfd-full', raw: { last_price: '2650.25', bid: '2650.10', ask: '2650.40', today_open_price: '2645.00', last_today_close_price: '2643.50', high_24h: '2660.00', low_24h: '2640.00', status: 'open' } },
  { label: 'cfd-no-book', raw: { last_price: '2650.25', today_open_price: '2645.00', last_today_close_price: '2643.50', status: 'open' } },
  { label: 'cfd-closed', raw: { last_price: '2650.25', bid: '2650.10', ask: '2650.40', status: 'closed' } },
  { label: 'empty', raw: {} },
  { label: 'null', raw: null },
];

export const KLINE_PROBES = [
  { label: 'cfd-array', raw: [{ t: '1700000000', o: '2650.0', h: '2651.0', l: '2649.0', c: '2650.5' }, { t: '1700000060', o: '2650.5', h: '2652.0', l: '2650.0', c: '2651.8' }] },
  { label: 'perp-array', raw: [{ t: 1700000000, o: '2650.0', h: '2651.0', l: '2649.0', c: '2650.5', v: 120 }] },
  { label: 'empty', raw: [] },
  { label: 'null', raw: null },
];

export const STREAM_NAME_PROBES = [
  'tradfi.candlesticks', 'futures.candlesticks', 'tradfi.tickers',
  'futures.tickers', 'futures.book_ticker', 'unknown.thing', '',
];

/** 时段快照：覆盖亚洲盘、伦敦盘、纽约盘、周末、美股节假日。 */
export const SESSION_PROBES = [
  { label: 'asia-mon', ms: 1_700_010_000_000 },
  { label: 'london-mon', ms: 1_700_040_000_000 },
  { label: 'ny-mon', ms: 1_700_058_000_000 },
  { label: 'sat', ms: 1_700_400_000_000 },
  { label: 'sun', ms: 1_700_480_000_000 },
  { label: 'thanksgiving-2023', ms: 1_700_838_000_000 },
  { label: 'christmas-2023', ms: 1_703_500_000_000 },
  { label: 'newyear-2024', ms: 1_704_100_000_000 },
];

export const VENUE_IDS = ['cn', 'hk', 'us', 'lse', 'tse', 'sgx'];

export const FROM_ZONED_PROBES = [
  ['Asia/Shanghai', 2024, 1, 15, 9, 30, 0],
  ['Asia/Shanghai', 2024, 7, 15, 21, 0, 0],
  ['America/New_York', 2024, 1, 15, 9, 30, 0],
  ['America/New_York', 2024, 7, 15, 9, 30, 0],
  ['Europe/London', 2024, 3, 31, 1, 30, 0],
  ['Asia/Tokyo', 2024, 12, 31, 23, 59, 59],
];
