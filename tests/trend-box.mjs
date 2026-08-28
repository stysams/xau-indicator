import { computeSuperTrend, getSuperTrend } from '../src/indicators/supertrend.js';
import { computeBox, getBox } from '../src/indicators/box.js';
import { state } from '../src/state.js';
import { assert, approx, assertNull } from './_lib/assert.mjs';

function bar(t, o, h, l, c) {
  return { t: t, o: o, h: h, l: l, c: c };
}

function resetCache() {
  state._stKey = '';
  state._st = null;
  state._boxKey = '';
  state._box = null;
}

// 收盘来回于 lo..hi 之间的锯齿波。影线只跟随本根收盘，保证峰谷的最高最低唯一，
// 否则峰值那根会和它后面一根影线等高，分形条件不成立。
function zigzag(n, lo, hi, half, t0, slope) {
  const bars = [];
  let prev = lo;
  for (let i = 0; i < n; i++) {
    const phase = i % (half * 2);
    const up = phase < half;
    const r = up ? phase / half : (phase - half) / half;
    const c = (up ? lo + (hi - lo) * r : hi - (hi - lo) * r) + (slope || 0) * i;
    const h = c + 0.15;
    const l = c - 0.15;
    bars.push(bar((t0 || 0) + i * 60, Math.min(h, Math.max(l, prev)), h, l, c));
    prev = c;
  }
  return bars;
}

// --- 超级趋势：period=2 / mult=1 全程手算 ---
{
  state.stN = 2;
  state.stK = 1;
  const klines = [
    bar(1, 10, 12, 9, 11),
    bar(2, 11, 13, 10, 12),
    bar(3, 12, 12.5, 11, 11.5),
    bar(4, 11.5, 14, 11, 13.5),
    bar(5, 13.5, 15, 13, 14),
    bar(6, 14, 15.5, 14, 15.2),
  ];
  const p = computeSuperTrend(klines);
  assert(p.ok, 'st ok');
  approx(p.period, 2, { label: 'st period' });
  approx(p.mult, 1, { label: 'st mult' });
  assert(p.st.length === klines.length, 'st series aligned');

  // 前 period 根没有 ATR，序列留空、方向为 0
  assertNull(p.st[0], 'st[0]');
  assertNull(p.st[1], 'st[1]');
  approx(p.dir[0], 0, { label: 'st dir[0]' });
  approx(p.dir[1], 0, { label: 'st dir[1]' });

  // i=2 起：ATR2 分别为 2.25 / 2.625 / 2.3125 / 1.90625
  // 空头段上轨被平滑钉在 14，直到收盘 15.2 站上 14 才翻多，翻多后取下轨
  approx(p.st[2], 14, { label: 'st[2] 上轨' });
  approx(p.st[3], 14, { label: 'st[3] 上轨只降不升' });
  approx(p.st[4], 14, { label: 'st[4] 收盘等于上轨不算穿越' });
  approx(p.st[5], 12.84375, { label: 'st[5] 翻多后取下轨' });
  approx(p.dir[2], -1, { label: 'st dir[2]' });
  approx(p.dir[4], -1, { label: 'st dir[4]' });
  approx(p.dir[5], 1, { label: 'st dir[5]' });

  // up 只在多头段有值，dn 只在空头段有值
  assertNull(p.up[4], 'st up[4] 空头段无值');
  approx(p.dn[4], 14, { label: 'st dn[4]' });
  approx(p.up[5], 12.84375, { label: 'st up[5]' });
  assertNull(p.dn[5], 'st dn[5] 多头段无值');

  assert(p.flips.length === 1, 'st flips 一次: ' + p.flips.length);
  approx(p.flips[0].i, 5, { label: 'st flip i' });
  approx(p.flips[0].dir, 1, { label: 'st flip dir' });
  approx(p.flips[0].price, 12.84375, { label: 'st flip price' });
  approx(p.flipAt, 5, { label: 'st flipAt' });
  approx(p.barsSinceFlip, 0, { label: 'st barsSinceFlip' });
  approx(p.lastDir, 1, { label: 'st lastDir' });
  approx(p.last, 12.84375, { label: 'st last' });
  assert(p.status === 'up', 'st status: ' + p.status);
}

// --- 超级趋势：样本不足 ---
{
  state.stN = 10;
  state.stK = 3;
  const p = computeSuperTrend([bar(1, 10, 11, 9, 10), bar(2, 10, 11, 9, 10)]);
  assert(!p.ok, 'st 样本不足 ok=false');
  assert(p.st.length === 0, 'st 样本不足空序列');
  approx(p.lastDir, 0, { label: 'st 样本不足 lastDir' });
}

// --- 超级趋势：单边行情定向，同方向段内跟踪线不回撤 ---
{
  state.stN = 10;
  state.stK = 3;
  const upBars = [];
  for (let i = 0; i < 60; i++) {
    const c = 100 + i * 1.2;
    upBars.push(bar(i * 60, c - 0.6, c + 0.5, c - 1.1, c));
  }
  const pUp = computeSuperTrend(upBars);
  approx(pUp.lastDir, 1, { label: '单边上涨 lastDir' });
  assert(pUp.last < upBars[upBars.length - 1].c, '上涨段跟踪线在价格下方');

  const dnBars = upBars.slice().reverse().map((k, i) => bar(i * 60, k.o, k.h, k.l, k.c));
  const pDn = computeSuperTrend(dnBars);
  approx(pDn.lastDir, -1, { label: '单边下跌 lastDir' });
  assert(pDn.last > dnBars[dnBars.length - 1].c, '下跌段跟踪线在价格上方');

  // 震荡数据上检查平滑规则：同方向连续段内 st 单调
  const zz = zigzag(120, 100, 108, 6);
  const pz = computeSuperTrend(zz);
  assert(pz.ok, 'st 震荡 ok');
  for (let i = state.stN + 1; i < zz.length; i++) {
    if (pz.dir[i] !== pz.dir[i - 1] || pz.st[i] == null || pz.st[i - 1] == null) continue;
    if (pz.dir[i] > 0) assert(pz.st[i] >= pz.st[i - 1] - 1e-9, '多头段 st 不下降 @' + i);
    else assert(pz.st[i] <= pz.st[i - 1] + 1e-9, '空头段 st 不上升 @' + i);
  }
  // 每个翻转点方向都与前一根相反
  pz.flips.forEach((fl) => {
    assert(pz.dir[fl.i - 1] === -fl.dir, 'flip 与前一根反向 @' + fl.i);
  });
}

// --- 超级趋势：倍数越大，跟踪线离价格越远 ---
{
  const zz = zigzag(120, 100, 108, 6);
  state.stN = 10;
  state.stK = 2;
  const tight = computeSuperTrend(zz);
  state.stK = 3;
  const wide = computeSuperTrend(zz);
  approx(tight.mult, 2, { label: 'mult=2 记录' });
  approx(wide.mult, 3, { label: 'mult=3 记录' });
  if (tight.lastDir === wide.lastDir) {
    const last = zz[zz.length - 1].c;
    assert(Math.abs(last - wide.last) > Math.abs(last - tight.last),
      '倍数大则轨道更远: ' + tight.last + ' / ' + wide.last);
  }
  assert(wide.flips.length <= tight.flips.length,
    '倍数大则换向不更多: ' + tight.flips.length + ' / ' + wide.flips.length);
}

// --- 超级趋势：缓存键包含周期与倍数 ---
{
  const zz = zigzag(120, 100, 108, 6);
  resetCache();
  state.stN = 10;
  state.stK = 3;
  const a = getSuperTrend(zz);
  assert(getSuperTrend(zz) === a, 'st 同参数命中缓存');
  state.stK = 2;
  const b = getSuperTrend(zz);
  assert(b !== a, 'st 换倍数后重算');
  approx(b.mult, 2, { label: 'st 缓存重算后的 mult' });
  state.stN = 14;
  const c = getSuperTrend(zz);
  assert(c !== b, 'st 换周期后重算');
  approx(c.period, 14, { label: 'st 缓存重算后的 period' });
}

// --- 箱体：样本不足 ---
{
  state.boxLen = 120;
  const p = computeBox(zigzag(10, 100, 105, 4));
  assert(!p.ok, '箱体样本不足 ok=false');
  assert(p.top == null && p.bottom == null, '箱体样本不足无上下沿');
}

// --- 箱体：来回震荡时识别上下沿与触碰 ---
{
  state.boxLen = 120;
  const zz = zigzag(64, 100, 105, 4);
  const p = computeBox(zz);
  assert(p.ok, '箱体 ok: ' + p.why);
  approx(p.top, 105.1, { label: '箱体上沿', atol: 0.35 });
  approx(p.bottom, 99.9, { label: '箱体下沿', atol: 0.35 });
  approx(p.mid, (p.top + p.bottom) / 2, { label: '箱体中轴' });
  approx(p.height, p.top - p.bottom, { label: '箱体高度' });
  assert(p.status === 'range', '箱体状态: ' + p.status);
  approx(p.dir, 0, { label: '箱体震荡无方向' });
  assert(p.topSwings >= 2 && p.botSwings >= 2, '上下沿各两次以上摆动点');
  assert(p.topTouches >= 2 && p.botTouches >= 2, '上下沿各两次以上触碰');
  assert(p.breakI === -1, '震荡中没有破位起点');
  assert(p.pos != null && p.pos >= 0 && p.pos <= 1, '现价位置在 0..1: ' + p.pos);
  assert(p.touches.length > 0 && p.touches.length <= 14, '触碰点数量有上限');
  p.touches.forEach((tc) => {
    assert(tc.i >= p.boxStart && tc.i < zz.length, '触碰点落在箱体内: ' + tc.i);
  });
  assert(p.boxStart >= 0 && p.boxStart < zz.length - 2, '箱体起点有效: ' + p.boxStart);
  assert(p.sig.indexOf('range') >= 0, '震荡 sig 带状态: ' + p.sig);
  assert(p.target == null, '未破位箱体不应有量度目标');
  assert(p.extension == null, '横向箱体不应强行画斜向扩展');
}

// --- 箱体：有三组以上平行摆动锚点时生成斜向通道参考 ---
{
  state.boxLen = 120;
  const rising = zigzag(120, 100, 105, 4, 0, 0.01);
  const p = computeBox(rising);
  assert(p.ok, '上倾箱体 ok: ' + p.why);
  assert(p.extension && p.extension.kind === 'channel', '上倾箱体生成斜向通道');
  assert(p.extension.dir === 1, '斜向通道方向向上');
  assert(p.extension.anchorCount >= 3, '斜向通道至少三组锚点');
  assert(p.extension.upper.toPrice > p.extension.upper.fromPrice, '上轨投影向上');
  assert(p.extension.lower.toPrice > p.extension.lower.fromPrice, '下轨投影向上');
  assert(p.extension.rms < p.atrv, '斜向通道拟合误差受控');

  const falling = zigzag(120, 105, 100, 4, 0, -0.01);
  const d = computeBox(falling);
  assert(d.ok, '下倾箱体 ok: ' + d.why);
  assert(d.extension && d.extension.dir === -1, '下倾箱体生成斜向通道');
  assert(d.extension.upper.toPrice < d.extension.upper.fromPrice, '下轨投影向下');
}

// --- 箱体：斜率方向不一致时不把结构误画成通道 ---
{
  state.boxLen = 120;
  const mixed = zigzag(120, 100, 105, 4, 0, 0);
  mixed.forEach((k, i) => {
    if (i >= 64 && i % 8 === 4) k.h += i * 0.03;
  });
  const p = computeBox(mixed);
  assert(p.ok, '混合斜率样本仍有箱体');
  assert(p.extension == null, '非平行结构不生成斜向通道');
}

// --- 箱体：破位后目标为一倍箱高 ---
{
  state.boxLen = 120;
  const zz = zigzag(64, 100, 105, 4);
  const upBreak = zz.concat([
    bar(64 * 60, 101.25, 106.2, 101.2, 106),
    bar(65 * 60, 106, 106.9, 105.9, 106.7),
    bar(66 * 60, 106.7, 107.6, 106.6, 107.4),
  ]);
  const pu = computeBox(upBreak);
  approx(pu.target, pu.top + pu.height, { label: '上破量度目标' });

  const dnBreak = zz.concat([
    bar(64 * 60, 101.25, 101.3, 98.5, 98.8),
    bar(65 * 60, 98.8, 98.9, 97.8, 98),
    bar(66 * 60, 98, 98.1, 97, 97.2),
  ]);
  const pd = computeBox(dnBreak);
  approx(pd.target, pd.bottom - pd.height, { label: '下破量度目标' });
}

// --- 箱体：收盘越过边缘记破位，破位起点指向连续段的第一根 ---
{
  state.boxLen = 120;
  const zz = zigzag(64, 100, 105, 4);
  const upBreak = zz.concat([
    bar(64 * 60, 101.25, 106.2, 101.2, 106),
    bar(65 * 60, 106, 106.9, 105.9, 106.7),
    bar(66 * 60, 106.7, 107.6, 106.6, 107.4),
  ]);
  const pu = computeBox(upBreak);
  assert(pu.ok, '上破仍给出箱体: ' + pu.why);
  assert(pu.status === 'breakUp', '上破状态: ' + pu.status);
  approx(pu.dir, 1, { label: '上破方向' });
  assert(pu.statusLab === '上破', '上破标签: ' + pu.statusLab);
  approx(pu.breakI, upBreak.length - 3, { label: '上破起点' });
  assert(pu.pos == null, '破位后不再给区间位置');
  assert(pu.sig.indexOf('breakUp') >= 0, '上破 sig 带状态: ' + pu.sig);
  assert(pu.sig !== computeBox(zz).sig, '破位前后 sig 不同');

  const dnBreak = zz.concat([
    bar(64 * 60, 101.25, 101.3, 98.5, 98.8),
    bar(65 * 60, 98.8, 98.9, 97.8, 98),
    bar(66 * 60, 98, 98.1, 97, 97.2),
  ]);
  const pd = computeBox(dnBreak);
  assert(pd.ok, '下破仍给出箱体: ' + pd.why);
  assert(pd.status === 'breakDn', '下破状态: ' + pd.status);
  approx(pd.dir, -1, { label: '下破方向' });
  approx(pd.breakI, dnBreak.length - 3, { label: '下破起点' });
  assert(pd.sig.indexOf('breakDn') >= 0, '下破 sig 带状态: ' + pd.sig);
}

// --- 箱体：单边趋势不误报 ---
{
  state.boxLen = 120;
  const trend = [];
  for (let i = 0; i < 60; i++) {
    const c = 100 + i * 1.2;
    trend.push(bar(i * 60, c - 0.6, c + 0.3, c - 0.9, c));
  }
  const p = computeBox(trend);
  assert(!p.ok, '单边上涨不应框出箱体: ' + p.status);
  assert(p.label === '箱体未现', '未现标签: ' + p.label);
}

// --- 箱体：回看根数生效并计入缓存键 ---
{
  const zz = zigzag(150, 100, 105, 4);
  resetCache();
  state.boxLen = 120;
  const a = getBox(zz);
  assert(getBox(zz) === a, '箱体同参数命中缓存');
  approx(a.len, 120, { label: 'boxLen=120 的回看根数' });
  state.boxLen = 60;
  const b = getBox(zz);
  assert(b !== a, '箱体换回看根数后重算');
  approx(b.len, 60, { label: 'boxLen=60 的回看根数' });
  assert(b.boxStart >= zz.length - 60, '回看变短后箱体起点收紧: ' + b.boxStart);
}

resetCache();
state.stN = 10;
state.stK = 3;
state.boxLen = 120;

console.log('PASS trend-box');
