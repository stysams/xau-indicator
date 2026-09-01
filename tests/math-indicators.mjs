import { ema, sma, bollCore, macdOf, rsiSeries, atr } from '../src/core/math.js';
import { analyzeBoll } from '../src/indicators/boll.js';
import { stackLayer } from '../src/indicators/stack.js';
import { state } from '../src/state.js';
import { assert, approx, assertNull } from './_lib/assert.mjs';

function bar(t, o, h, l, c) {
  return { t: t, o: o, h: h, l: l, c: c };
}

// --- ema：首值种子，k=2/(period+1) ---
{
  const out = ema([10, 11, 12, 13, 14], 3);
  // k=0.5
  approx(out[0], 10, { label: 'ema[0]' });
  approx(out[1], 10.5, { label: 'ema[1]' });
  approx(out[2], 11.25, { label: 'ema[2]' });
  approx(out[3], 12.125, { label: 'ema[3]' });
  approx(out[4], 13.0625, { label: 'ema[4]' });
  assert(ema([]).length === 0, 'ema empty');
}

// --- sma：前 period-1 根预热为空，随后为滚动算术平均 ---
{
  const out = sma([1, 2, 3, 4, 5], 3);
  assert(out[0] == null && out[1] == null, 'sma warmup');
  approx(out[2], 2, { label: 'sma[2]' });
  approx(out[4], 4, { label: 'sma[4]' });
}

// --- bollCore：总体标准差（除以 period，非 n-1）；前 period-1 为 null ---
{
  const closes = [1, 2, 3, 4, 5];
  const core = bollCore(closes, 3);
  assertNull(core.mid[0], 'boll mid[0]');
  assertNull(core.mid[1], 'boll mid[1]');
  approx(core.mid[2], 2, { label: 'boll mid[2]' });
  approx(core.sd[2], Math.sqrt(2 / 3), { label: 'boll sd[2]' });
  approx(core.mid[4], 4, { label: 'boll mid[4]' });
  approx(core.sd[4], Math.sqrt(2 / 3), { label: 'boll sd[4]' });

  const short = bollCore([1, 2], 5);
  assert(short.mid.every((v) => v == null), 'boll short all null mid');
  assert(short.sd.every((v) => v == null), 'boll short all null sd');
}

// --- macdOf：以抽出的实际行为为准——前 33 根 DIF/DEA/hist 为 null（A8 已修）---
{
  const closes = [];
  for (let i = 0; i < 80; i++) closes.push(100 + Math.sin(i / 5) * 2 + i * 0.01);
  const empty = macdOf(closes.slice(0, 20));
  assert(empty.dif.every((v) => v == null), 'macd n<26 all null dif');

  const pack = macdOf(closes);
  for (let i = 0; i < 33; i++) {
    assertNull(pack.dif[i], 'macd dif warm ' + i);
    assertNull(pack.dea[i], 'macd dea warm ' + i);
    assertNull(pack.hist[i], 'macd hist warm ' + i);
  }
  assert(pack.dif[33] != null, 'macd dif[33] live');
  assert(pack.dea[33] != null, 'macd dea[33] live');
  assert(pack.hist[33] != null, 'macd hist[33] live');

  // hist = 2*(dif-dea)
  approx(pack.hist[50], 2 * (pack.dif[50] - pack.dea[50]), { label: 'macd hist=2*(dif-dea)' });

  // 与手算 ema 路径对齐（无预热屏蔽的 raw，再比 warm 后）
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const difRaw = closes.map((_, i) => e12[i] - e26[i]);
  const deaRaw = ema(difRaw, 9);
  approx(pack.dif[40], difRaw[40], { label: 'macd dif vs ema path' });
  approx(pack.dea[40], deaRaw[40], { label: 'macd dea vs ema path' });
}

// --- analyzeBoll：暴露最新一根已收盘 K 线的三条轨道价格 ---
{
  const oldN = state.bollN;
  const oldK = state.bollK;
  state.bollN = 3;
  state.bollK = 2;
  const klines = [1, 2, 3, 4, 5].map((c, i) => bar(i + 1, c, c, c, c));
  const b = analyzeBoll(klines);
  const sd = Math.sqrt(2 / 3);
  approx(b.lastMid, 4, { label: 'boll last mid' });
  approx(b.lastUp, 4 + 2 * sd, { label: 'boll last up' });
  approx(b.lastDn, 4 - 2 * sd, { label: 'boll last dn' });
  const layer = stackLayer(klines, { id: '1m', name: '1分' });
  approx(layer.lastMid, b.lastMid, { label: 'stack last mid' });
  approx(layer.lastUp, b.lastUp, { label: 'stack last up' });
  approx(layer.lastDn, b.lastDn, { label: 'stack last dn' });
  state.bollN = oldN;
  state.bollK = oldK;
}

// --- rsiSeries：Wilder；ag=al=0 时返回 50（已修，不再是 100）---
{
  const flat = new Array(30).fill(100);
  const rsiFlat = rsiSeries(flat, 14);
  for (let i = 0; i < 14; i++) assertNull(rsiFlat[i], 'rsi warm ' + i);
  approx(rsiFlat[14], 50, { label: 'rsi flat first=50' });
  approx(rsiFlat[29], 50, { label: 'rsi flat last=50' });

  // 单调上涨：loss=0 → RSI=100
  const up = [];
  for (let i = 0; i < 30; i++) up.push(100 + i);
  const rsiUp = rsiSeries(up, 14);
  approx(rsiUp[14], 100, { label: 'rsi up=100' });
  approx(rsiUp[29], 100, { label: 'rsi up last=100' });

  // 手算首值：14 段变动全为 +1/-混合
  // closes: 10,11,10,11,10,11,10,11,10,11,10,11,10,11,10  → 前 14 段：+1,-1 交替 7 次
  const zig = [];
  for (let i = 0; i < 20; i++) zig.push(i % 2 === 0 ? 10 : 11);
  const rsiZig = rsiSeries(zig, 14);
  // 前 14 段：7 个 +1、7 个 -1 → ag=0.5, al=0.5 → RSI=50
  approx(rsiZig[14], 50, { label: 'rsi zig first=50' });
}

// --- atr：Wilder TR 平滑；含跳空 ---
{
  const klines = [
    bar(1, 10, 12, 9, 11),
    bar(2, 11, 13, 10, 12),   // TR=max(3,|13-11|,|10-11|)=3
    bar(3, 12, 12.5, 11, 11.5), // TR=max(1.5,0.5,1)=1.5
    bar(4, 11.5, 14, 11, 13.5),
    bar(5, 13.5, 15, 13, 14),
    bar(6, 14, 14.5, 12, 12.5),
    bar(7, 12.5, 13, 12, 12.8),
    bar(8, 12.8, 13.2, 12.5, 13),
    bar(9, 13, 13.5, 12.8, 13.2),
    bar(10, 13.2, 14, 13, 13.8),
    bar(11, 13.8, 14.2, 13.5, 14),
    bar(12, 14, 14.5, 13.8, 14.2),
    bar(13, 14.2, 14.8, 14, 14.5),
    bar(14, 14.5, 15, 14.2, 14.8),
    bar(15, 14.8, 16, 14.5, 15.5), // 需要 period+1 根 → 至少 15 根给 period=14
  ];
  // period=2 便于手算
  // trs: i=1→3, i=2→1.5, i=3→max(3,|14-11.5|,|11-11.5|)=3, ...
  const a2 = atr(klines.slice(0, 4), 2);
  // seed = (3+1.5)/2 = 2.25；再吃 tr3=3 → (2.25*1 + 3)/2 = 2.625
  approx(a2, 2.625, { label: 'atr period2' });

  assert(atr(klines.slice(0, 10), 14) == null, 'atr too short → null');
  const a14 = atr(klines, 14);
  assert(a14 != null && a14 > 0, 'atr14 positive');
}

console.log('PASS math-indicators');
