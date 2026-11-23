import { tfSpanMs } from '../src/core/bars.js';
import { bwRankWindow } from '../src/core/math.js';
import {
  BE_CUSHION_ATR,
  SESSION_PROFILES,
  computePatternPlan,
  computeRangeFilter,
  detectBarPattern,
  detectLowLatencyPattern,
  efficiencyRatio,
  formatSessionMults,
  isBlockedByWall,
  normalizePatternMode,
  sessionProfileForTs,
} from '../src/indicators/pattern.js';
import { findXaudzSetups } from '../src/indicators/xaudz.js';
import { parseStreamName, liveEndFor } from '../src/net/rest.js';
import { MARKETS, PAD, W, state } from '../src/state.js';
import { layoutPatternPlan } from '../src/view/overlays.js';
import { chartXScale } from '../src/view/viewport.js';
import { approx, assert } from './_lib/assert.mjs';

function bar(t, o, h, l, c) {
  return { t: t, o: o, h: h, l: l, c: c };
}

// 0. 3 分钟周期基础链路校验
{
  assert(tfSpanMs('3m') === 180000, '3m 周期跨度应为 180000ms');
  assert(bwRankWindow('3m') === 108, '3m 带宽分位窗口应为 108');
  const parsed = parseStreamName('3m_XAUUSD');
  assert(parsed.interval === '3m' && parsed.symbol === 'XAUUSD', '3m WebSocket 通道名解析');
  assert(MARKETS.xau.stream.includes('3m'), 'XAU 支持 3m 订阅');
  assert(MARKETS.eth.stream.includes('3m'), 'ETH 支持 3m 订阅');
  assert(MARKETS.btc.stream.includes('3m'), 'BTC 支持 3m 订阅');
}

// 1. 时段与倍数检查（北京时间）
{
  const asiaTs = Date.UTC(2026, 5, 1, 2, 30, 0); // BJ 10:30 -> 亚盘
  const eurTs = Date.UTC(2026, 5, 1, 8, 30, 0);  // BJ 16:30 -> 欧盘
  const ovlTs = Date.UTC(2026, 5, 1, 13, 30, 0); // BJ 21:30 -> 欧美重叠
  const usTs = Date.UTC(2026, 5, 1, 18, 30, 0);  // BJ 02:30 -> 美盘

  const sAsia = sessionProfileForTs(asiaTs);
  assert(sAsia.id === 'asia' && sAsia.name === '亚盘', '亚盘时段识别');
  assert(formatSessionMults(sAsia) === 'SL×1.5 | TP1×1.5 | TP2×3.45', '亚盘倍数格式与 1:1 TP1 / 2.3R TP2 一致');
  Object.values(SESSION_PROFILES).forEach((s) => {
    approx(s.tp1Mult, s.slMult, { tol: 1e-9, label: s.name + '基础第一止盈应与止损 1:1' });
  });

  assert(sessionProfileForTs(eurTs).id === 'europe', '欧盘时段识别');
  assert(sessionProfileForTs(ovlTs).id === 'overlap', '欧美重叠时段识别');
  assert(sessionProfileForTs(usTs).id === 'us', '美盘时段识别');
}

// 2. 经典 K 线形态识别与收盘强度过滤
{
  const atrArr = new Array(10).fill(2.0);

  // 看涨吞没（强收盘）
  const bullEngulf = [
    bar(1, 3700, 3701, 3699, 3700),
    bar(2, 3700, 3700.5, 3698.2, 3698.6),
    bar(3, 3698.5, 3701.8, 3698.1, 3701.5),
  ];
  const p1 = detectBarPattern(bullEngulf, 2, atrArr);
  assert(p1 && p1.dir === 1 && p1.code === 'bull_engulf', '识别看涨吞没');

  // 看涨吞没若带极长上影线（弱收盘），在 strict 档下应被过滤
  const weakEngulf = [
    bar(1, 3700, 3701, 3699, 3700),
    bar(2, 3700, 3700.5, 3698.2, 3698.6),
    bar(3, 3698.5, 3704.2, 3698.1, 3701.0),
  ];
  assert(detectBarPattern(weakEngulf, 2, atrArr, 'strict') === null, '稳健档应过滤弱收盘长上影吞没');

  // 看跌吞没
  const bearEngulf = [
    bar(1, 3700, 3701, 3699, 3700),
    bar(2, 3700, 3701.8, 3699.6, 3701.4),
    bar(3, 3701.5, 3701.9, 3698.2, 3698.5),
  ];
  const p2 = detectBarPattern(bearEngulf, 2, atrArr);
  assert(p2 && p2.dir === -1 && p2.code === 'bear_engulf', '识别看跌吞没');

  // 启明星 / 黄昏之星
  const morningStar = [
    bar(1, 3705, 3705.5, 3701.5, 3702.0),
    bar(2, 3701.8, 3702.1, 3701.0, 3701.5),
    bar(3, 3701.7, 3704.6, 3701.5, 3704.3),
  ];
  const p3 = detectBarPattern(morningStar, 2, atrArr);
  assert(p3 && p3.dir === 1 && p3.code === 'morning_star', '识别启明星');

  const eveningStar = [
    bar(1, 3700, 3703.5, 3699.8, 3703.0),
    bar(2, 3703.2, 3704.0, 3702.9, 3703.4),
    bar(3, 3703.2, 3703.5, 3700.4, 3700.7),
  ];
  const p4 = detectBarPattern(eveningStar, 2, atrArr);
  assert(p4 && p4.dir === -1 && p4.code === 'evening_star', '识别黄昏之星');

  // 锤子线 / 流星线
  const hammerBars = [
    bar(1, 3706, 3707, 3704, 3705),
    bar(2, 3705, 3705.5, 3703, 3703.5),
    bar(3, 3703.5, 3704, 3702, 3702.5),
    bar(4, 3702.5, 3703, 3701, 3701.8),
    bar(5, 3701.8, 3702.2, 3698.6, 3701.7),
  ];
  const p7 = detectBarPattern(hammerBars, 4, atrArr);
  assert(p7 && p7.dir === 1 && p7.code === 'hammer', '识别锤子线');

  const starBars = [
    bar(1, 3700, 3702, 3699, 3701),
    bar(2, 3701, 3703, 3700.5, 3702.5),
    bar(3, 3702.5, 3704, 3702, 3703.5),
    bar(4, 3703.5, 3705, 3703, 3704.2),
    bar(5, 3704.2, 3707.6, 3703.8, 3704.3),
  ];
  const p8 = detectBarPattern(starBars, 4, atrArr);
  assert(p8 && p8.dir === -1 && p8.code === 'shooting_star', '识别流星线');
}

// 3. 完整序列：空头趋势 + 回踩 EMA20 附近看跌吞没 -> 产生空头订单，并验证 TP1 自动移动保本
{
  state.tf = '3m';
  state.mkt = 'xau';
  const baseT = Math.floor(Date.UTC(2026, 5, 1, 2, 0, 0) / 1000); // BJ 10:00 亚盘
  const klines = [];
  let pxVal = 3780;
  // 清晰的空头趋势（阶梯下行），随后回抽触及 EMA20 附近走出看跌吞没
  for (let i = 0; i < 36; i++) {
    const o = pxVal;
    const step = (i % 4 === 3) ? 0.30 : -0.55;
    const c = o + step;
    klines.push(bar(baseT + i * 180, o, Math.max(o, c) + 0.35, Math.min(o, c) - 0.35, c));
    pxVal = c;
  }
  // 反抽触及 EMA20，让 RSI 回到健康区间（> 32）且未偏离均线过远
  const o36 = pxVal;
  const c36 = o36 + 1.6;
  klines.push(bar(baseT + 36 * 180, o36, c36 + 0.35, o36 - 0.15, c36));
  const o37 = c36;
  const c37 = o37 + 0.95;
  klines.push(bar(baseT + 37 * 180, o37, c37 + 0.4, o37 - 0.15, c37));
  // 第 38 根：在 EMA20 附近走出大阴看跌吞没，收盘落回 EMA20 下方
  const o38 = c37 + 0.05;
  const c38 = o37 - 1.15;
  klines.push(bar(baseT + 38 * 180, o38, o38 + 0.2, c38 - 0.15, c38));
  // 第 39 根：先小幅持有（尚未触 TP1）
  const c39 = c38 - 0.3;
  klines.push(bar(baseT + 39 * 180, c38, c38 + 0.2, c39 - 0.1, c39));

  const plan = computePatternPlan(klines, { last: c39 }, Date.UTC(2026, 5, 1, 2, 33, 0), 'strict');
  assert(plan.ok, '样本充足时计算成功');
  assert(plan.session.id === 'asia', '当前时段为亚盘');
  assert(plan.trendDir === -1 && plan.trendLab === '空头趋势', '趋势方向为空头趋势');
  assert(plan.active && plan.active.dir === -1, '存在顺势空头持仓订单');
  assert(plan.active.sl > plan.active.entry, '空单止损高于开仓价');
  assert(plan.active.tp1 < plan.active.entry && plan.active.tp2 < plan.active.tp1, '空单 TP1 < 开仓 且 TP2 < TP1');
  const distSl = plan.active.origSl - plan.active.entry;
  const distTp1 = plan.active.entry - plan.active.tp1;
  const distTp2 = plan.active.entry - plan.active.tp2;
  const minSl = plan.active.atr * SESSION_PROFILES.asia.slMult * 0.85;
  const maxSl = plan.active.atr * (SESSION_PROFILES.asia.slMult + 0.30);
  assert(distSl >= minSl - 1e-6 && distSl <= maxSl + 1e-6, '止损应位于双向限幅区间 [0.85×base, base+0.30] ATR 内');
  approx(distTp1, distSl, { tol: 1e-6, label: '第一止盈距离应与初始止损严格保持 1:1' });
  approx(distTp2 / distSl, SESSION_PROFILES.asia.tp2Mult / SESSION_PROFILES.asia.slMult, { tol: 1e-6, label: '第二止盈按盘口盈亏比等比映射' });
  assert(plan.pnlPts > 0 && plan.pnlPct > 0, '空单价格下跌时浮盈为正');

  // 追加一根触及 TP1 但未到 TP2 的 K 线，验证止损自动移至盈利侧保本锁盈（含 0.05 ATR 锁利缓冲）
  const tp1Bar = bar(
    baseT + 40 * 180,
    c39,
    c39 + 0.1,
    plan.active.tp1 - 0.2,
    plan.active.tp1 + 0.1
  );
  const planBe = computePatternPlan(klines.concat([tp1Bar]), { last: tp1Bar.c }, Date.UTC(2026, 5, 1, 2, 36, 0), 'strict');
  assert(planBe.active && planBe.active.hitTp1 && planBe.active.breakeven, '触及 TP1 后开启保本止损');
  approx(planBe.active.sl, planBe.active.entry - planBe.active.atr * BE_CUSHION_ATR, { tol: 1e-6, label: '空单保本止损移至盈利侧锁盈 0.05 ATR' });

  // 三档灵敏度归一化与切换检查
  assert(normalizePatternMode('classic') === 'classic', '经典档归一化');
  assert(normalizePatternMode('safe') === 'safe', '防追顶档归一化');
  assert(normalizePatternMode('strict') === 'strict', '稳健档归一化');
  assert(normalizePatternMode('unknown') === 'classic', '未知档回退为经典');
  const pClassic = computePatternPlan(klines, { last: c39 }, Date.UTC(2026, 5, 1, 2, 33, 0), 'classic');
  const pSafe = computePatternPlan(klines, { last: c39 }, Date.UTC(2026, 5, 1, 2, 33, 0), 'safe');
  assert(pClassic.ok && pClassic.mode === 'classic' && pSafe.ok && pSafe.mode === 'safe', '三档均正常输出');
  assert(pClassic.marks.length >= plan.marks.length, '经典档信号数不少于稳健档');
}

// 4. 震荡过滤校验（稳健档）：来回锯齿行情中 ER < 0.14，应拒绝开单
{
  state.tf = '3m';
  const baseT = Math.floor(Date.UTC(2026, 5, 1, 2, 0, 0) / 1000);
  const chop = [];
  for (let i = 0; i < 45; i++) {
    const up = i % 2 === 0;
    const o = up ? 3700 : 3703;
    const c = up ? 3703 : 3700;
    chop.push(bar(baseT + i * 180, o, 3703.5, 3699.5, c));
  }
  const closes = chop.map((k) => k.c);
  assert(efficiencyRatio(closes, closes.length - 1, 14) < 0.14, '锯齿震荡 ER 应低于阈值');
  const plan = computePatternPlan(chop, { last: 3700 }, Date.UTC(2026, 5, 1, 4, 0, 0), 'strict');
  assert(plan.ok && plan.chopFiltered, '震荡行情标记 chopFiltered');
  assert(!plan.active && plan.marks.length === 0, '稳健档震荡行情中不乱开单');
}

// 5. 未收盘 K 线不提前确认开单
{
  state.tf = '3m';
  const nowSec = Math.floor(Date.now() / 1000);
  const klines = [];
  let pxVal = 3700;
  for (let i = 0; i < 36; i++) {
    const o = pxVal;
    const step = (i % 3 === 2) ? -0.55 : 0.85;
    const c = o + step;
    klines.push(bar(nowSec - (39 - i) * 180, o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c));
    pxVal = c;
  }
  // 连续两根已收盘回调至 EMA20 附近
  for (let i = 0; i < 2; i++) {
    const o = pxVal;
    const c = o - 0.9;
    klines.push(bar(nowSec - (3 - i) * 180, o, o + 0.2, c - 0.2, c));
    pxVal = c;
  }
  // 倒数第 2 根（已收盘小阴）
  const oPrev = pxVal;
  const cPrev = oPrev - 0.7;
  klines.push(bar(nowSec - 200, oPrev, oPrev + 0.15, cPrev - 0.15, cPrev));
  // 最后一根（未收盘大阳吞没）
  klines.push(bar(nowSec - 20, cPrev - 0.05, oPrev + 1.4, cPrev - 0.1, oPrev + 1.3));

  const plan = computePatternPlan(klines, { last: oPrev + 1.3 });
  assert(!plan.active || plan.active.i < klines.length - 1, '未收盘棒不得确认开仓');
}

// 6. Range Filter 方向单调性基础校验
{
  const upCloses = Array.from({ length: 40 }, (_, i) => 3700 + i * 1.2);
  const rfUp = computeRangeFilter(upCloses, 14, 1.8);
  assert(rfUp.dir[rfUp.dir.length - 1] === 1, '持续上涨序列 RF 方向为多');
  const dnCloses = Array.from({ length: 40 }, (_, i) => 3750 - i * 1.2);
  const rfDn = computeRangeFilter(dnCloses, 14, 1.8);
  assert(rfDn.dir[rfDn.dir.length - 1] === -1, '持续下跌序列 RF 方向为空');
}

// 7. 多重压力墙防撞顶校验：3742 双顶压力区拦截追多，不拦截做空
{
  const kl = [];
  for (let i = 0; i < 30; i++) {
    // 两次在 3743.0 附近触顶受阻（bar 10 和 bar 20），随后 bar 29 贴近 3742.2
    const peak = (i === 10 || i === 20);
    const h = peak ? 3743.0 : (i === 29 ? 3742.3 : 3739.5);
    const l = 3737.0;
    const c = i === 29 ? 3742.2 : 3738.5;
    kl.push(bar(1000 + i * 60, 3738.0, h, l, c));
  }
  assert(isBlockedByWall(kl, 29, 1, 2.0, null) === true, '双顶压力天花板下方应拦截追多');
  assert(isBlockedByWall(kl, 29, -1, 2.0, null) === false, '压力天花板下方不应拦截做空');
}

// 8. xaudz 按收盘判定多空，止盈为初始止损距离的 1、2 倍。
{
  state.mkt = 'xau';
  state.tf = '1m';
  assert(normalizePatternMode('xaudz') === 'xaudz', '第四档应保留在设置中');
  const baseT = 1795017600;
  const warmup = Array.from({ length: 100 }, (_, i) => bar(baseT + i * 60, 3700, 3700.5, 3699.5, 3700));
  const t = baseT + 100 * 60;
  for (const dir of [1, -1]) {
    const bars = warmup.concat(bar(t, 3700, dir > 0 ? 3703.2 : 3700.2, dir > 0 ? 3699.8 : 3696.8, 3700 + dir * 3));
    const forming = computePatternPlan(bars, null, (t + 60) * 1000 - 1, 'xaudz');
    assert(forming.ok && forming.marks.length === 0, '未收盘的突破不得触发 xaudz');

    const closed = computePatternPlan(bars, null, (t + 60) * 1000, 'xaudz');
    assert(closed.active?.dir === dir && closed.marks.length === 1, '收盘后应输出同方向信号');
    const { entry, sl, tp1, tp2 } = closed.active;
    const risk = dir * (entry - sl);
    assert(risk > 0, '止损应在反方向');
    approx(dir * (tp1 - entry), risk, { label: 'xaudz 第一止盈 1R' });
    approx(dir * (tp2 - entry), 2 * risk, { label: 'xaudz 第二止盈 2R' });

    const firstTarget = bar(t + 60, entry, Math.max(entry, tp1), Math.min(entry, tp1), tp1);
    const first = computePatternPlan(bars.concat(firstTarget), null, (t + 120) * 1000, 'xaudz');
    assert(first.active?.hitTp1 && first.active?.breakeven && !first.lastClosed, '达到 TP1 后开启保本并继续跟踪');
    approx(first.active.sl, entry, { label: 'xaudz 达到 TP1 后止损移至开仓价保本' });

    const secondTarget = bar(t + 120, tp1, Math.max(tp1, tp2), Math.min(tp1, tp2), tp2);
    const final = computePatternPlan(bars.concat(firstTarget, secondTarget), null, (t + 180) * 1000, 'xaudz');
    assert(!final.active && final.lastClosed?.status === 'tp2', '达到 TP2 后结算');
    approx(final.lastClosed.exitPx, tp2, { label: 'xaudz 按 TP2 价格结算' });
    assert(final.stats.tp2Hits === 1 && final.stats.wins === 1, '统计已结算的 TP2');
  }

  state.tf = '5m';
  assert(!computePatternPlan(warmup, null, undefined, 'xaudz').ok, 'xaudz 仅支持一分钟');
  state.tf = '1m';
  state.mkt = 'eth';
  assert(!computePatternPlan(warmup, null, undefined, 'xaudz').ok, 'xaudz 仅支持黄金');
  state.mkt = 'xau';
}

// 9. 形态开单绘图布局校验：开仓/止损/TP1/TP2 文字标签与 Buy/Sell 气泡不得遮挡 K 线
{
  const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  const xRight = W - PAD.r;
  const plotTop = PAD.t;
  const plotBottom = 360;

  const baseT = Math.floor(Date.UTC(2026, 5, 1, 2, 0, 0) / 1000);
  const klines = [];
  let pxVal = 3780;
  for (let i = 0; i < 36; i++) {
    const o = pxVal;
    const step = (i % 4 === 3) ? 0.30 : -0.55;
    const c = o + step;
    klines.push(bar(baseT + i * 180, o, Math.max(o, c) + 0.35, Math.min(o, c) - 0.35, c));
    pxVal = c;
  }
  const o36 = pxVal;
  const c36 = o36 + 1.6;
  klines.push(bar(baseT + 36 * 180, o36, c36 + 0.35, o36 - 0.15, c36));
  const o37 = c36;
  const c37 = o37 + 0.95;
  // 让触发前一根带更长上影，检验 Sell 气泡是否避开相邻棒的影线
  klines.push(bar(baseT + 37 * 180, o37, c37 + 1.1, o37 - 0.15, c37));
  const o38 = c37 + 0.05;
  const c38 = o37 - 1.15;
  klines.push(bar(baseT + 38 * 180, o38, o38 + 0.2, c38 - 0.15, c38));
  const c39 = c38 - 0.3;
  klines.push(bar(baseT + 39 * 180, c38, c38 + 0.2, c39 - 0.1, c39));

  const plan = computePatternPlan(klines, { last: c39 }, Date.UTC(2026, 5, 1, 2, 33, 0), 'strict');
  assert(plan.active, '绘图布局测试应存在活跃订单');

  // (a) 盯盘模式（右侧有留白）
  const count = klines.length;
  const endLive = Math.round(liveEndFor(klines.length, count));
  const startLive = endLive - count;
  const i0Live = Math.max(0, startLive);
  const visLive = klines.slice(i0Live, Math.min(klines.length, endLive));
  const viewLive = { start: startLive, end: endLive, count: count, bars: visLive, follow: true };
  let lo = Infinity;
  let hi = -Infinity;
  visLive.forEach((k) => { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); });
  [plan.active.entry, plan.active.sl, plan.active.tp1, plan.active.tp2].forEach((v) => {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  });
  const padY = (hi - lo) * 0.08 || 1;
  lo -= padY;
  hi += padY;
  const scaleLive = chartXScale(viewLive, PAD.l, xRight);
  const yFn = (v) => plotTop + (hi - v) / (hi - lo) * (plotBottom - plotTop);

  const layoutLive = layoutPatternPlan(
    plan, visLive, viewLive, scaleLive.local, scaleLive.clampedIndex, yFn, xRight, plotTop, plotBottom
  );
  assert(layoutLive.order && layoutLive.order.lines.length === 4, '应输出 4 条订单水平线标签');
  assert(layoutLive.order.inlineMode === true, '盯盘模式应启用示例图右侧同行标注模式');
  assert(layoutLive.order.lines.some((r) => /^入场\(.+\)$/.test(r.lab)), '入场标签应采用 入场(价格) 格式');
  assert(layoutLive.order.lines.some((r) => /^止损\(.+\)$/.test(r.lab)), '止损标签应采用 止损(价格) 格式');
  assert(layoutLive.order.lines.some((r) => /^TP1\(.+\)/.test(r.lab)), 'TP1 标签应采用 TP1(价格) 格式');
  assert(layoutLive.order.lines.some((r) => /^TP2\(.+\)$/.test(r.lab)), 'TP2 标签应采用 TP2(价格) 格式');
  layoutLive.order.lines.forEach((row) => {
    assert(row.lineX2 >= layoutLive.lastCandleRight + 20, '水平线应向右延伸到 K 线外侧留白区后截停: ' + row.lab);
    assert(row.labX >= row.lineX2 + 8, '文字应位于水平线右端外侧，不与线条或 K 线重叠: ' + row.lab);
    layoutLive.candleBoxes.forEach((cb) => {
      const candleBox = { x1: cb.x1, y1: cb.yTop, x2: cb.x2, y2: cb.yBot };
      assert(!overlap(row.box, candleBox), '标签不得遮挡任何 K 线: ' + row.lab);
    });
  });
  for (let i = 0; i < layoutLive.order.lines.length; i++) {
    for (let j = i + 1; j < layoutLive.order.lines.length; j++) {
      assert(!overlap(layoutLive.order.lines[i].box, layoutLive.order.lines[j].box), '订单标签之间不得互相重叠');
    }
  }
  layoutLive.marks.forEach((mkItem) => {
    layoutLive.candleBoxes.forEach((cb) => {
      const candleBox = { x1: cb.x1, y1: cb.yTop, x2: cb.x2, y2: cb.yBot };
      const pillRect = {
        x1: mkItem.xc - mkItem.pillW / 2,
        y1: mkItem.pillTop,
        x2: mkItem.xc + mkItem.pillW / 2,
        y2: mkItem.pillTop + mkItem.pillH,
      };
      assert(!overlap(pillRect, candleBox), 'Buy/Sell 气泡矩形不得遮挡触发棒或相邻 K 线');
    });
  });

  // (b) 历史回看视窗（K 线铺满至右边界，无右侧留白）+ 保本止损紧贴开仓价
  const tp1Bar = bar(baseT + 40 * 180, c39, c39 + 0.1, plan.active.tp1 - 0.2, plan.active.tp1 + 0.1);
  const barsBe = klines.concat([tp1Bar]);
  const planBe = computePatternPlan(barsBe, { last: tp1Bar.c }, Date.UTC(2026, 5, 1, 2, 36, 0), 'strict');
  assert(planBe.active && planBe.active.hitTp1 && planBe.active.hitTp1I === 40, '触达 TP1 应记录触发棒索引');
  const viewHist = { start: 0, end: barsBe.length, count: barsBe.length, bars: barsBe, follow: false };
  const scaleHist = chartXScale(viewHist, PAD.l, xRight);
  const layoutHist = layoutPatternPlan(
    planBe, barsBe, viewHist, scaleHist.local, scaleHist.clampedIndex, yFn, xRight, plotTop, plotBottom
  );
  assert(layoutHist.order && layoutHist.order.lines.length === 4, '历史视窗下同样输出 4 条标签');
  assert(layoutHist.order.lines.some((r) => /^保本止损\(.+\)$/.test(r.lab)), '保本止损应采用 保本止损(价格) 格式');
  assert(layoutHist.order.lines.some((r) => /^TP1\(.+\) ✓$/.test(r.lab)), '触达 TP1 后右侧标签应附带 ✓');
  for (let i = 0; i < layoutHist.order.lines.length; i++) {
    for (let j = i + 1; j < layoutHist.order.lines.length; j++) {
      assert(!overlap(layoutHist.order.lines[i].box, layoutHist.order.lines[j].box), '保本止损紧贴开仓价时标签仍不得重叠');
    }
  }
  layoutHist.order.lines.forEach((row) => {
    layoutHist.candleBoxes.forEach((cb) => {
      const bodyBox = { x1: cb.x1, y1: cb.bodyTop, x2: cb.x2, y2: cb.bodyBot };
      assert(!overlap(row.box, bodyBox), '历史满屏视窗下标签不得遮挡 K 线实体: ' + row.lab);
    });
  });
  layoutHist.hitMarks.forEach((hm) => {
    layoutHist.candleBoxes.forEach((cb) => {
      const candleBox = { x1: cb.x1, y1: cb.yTop, x2: cb.x2, y2: cb.yBot };
      assert(!overlap(hm.box, candleBox), 'TP1/TP2 达标勾号标注不得遮挡 K 线');
    });
  });
}

// 10. 低延迟单棒形态（扫荡收回 / 回踩拒收）与智能布林墙过滤校验
{
  const atrArr = new Array(12).fill(2.0);
  // 扫低收回：刺破前 6 根低点 3700 后长下影收回至 3701.8
  const sweepUpBars = [
    bar(1, 3702, 3703, 3700.5, 3701.5),
    bar(2, 3701.5, 3702.5, 3700.2, 3701.0),
    bar(3, 3701.0, 3702.2, 3700.4, 3701.6),
    bar(4, 3701.6, 3702.4, 3700.1, 3701.2),
    bar(5, 3701.2, 3702.0, 3700.3, 3700.9),
    bar(6, 3700.9, 3701.8, 3700.0, 3700.8),
    bar(7, 3700.8, 3702.0, 3698.4, 3701.8),
  ];
  const pSweep = detectLowLatencyPattern(sweepUpBars, 6, atrArr, null, null);
  assert(pSweep && pSweep.dir === 1 && pSweep.code === 'sweep_up', '识别扫低收回低延迟反转形态');

  // 顺势均线回踩拒跌
  const e9 = [3700, 3701, 3702, 3703, 3704, 3705, 3706];
  const e20 = [3698, 3698.5, 3699, 3699.6, 3700.2, 3701.0, 3702.0];
  const pbBars = [
    bar(1, 3701, 3702, 3700, 3701.5),
    bar(2, 3701.5, 3703, 3701, 3702.5),
    bar(3, 3702.5, 3704, 3702, 3703.5),
    bar(4, 3703.5, 3705, 3703, 3704.5),
    bar(5, 3704.5, 3706, 3704, 3705.5),
    bar(6, 3705.5, 3707, 3705, 3706.5),
    bar(7, 3706.2, 3707.2, 3704.5, 3707.0),
  ];
  const pPb = detectLowLatencyPattern(pbBars, 6, atrArr, e9, e20);
  assert(pPb && pPb.dir === 1 && pPb.code === 'pb_reject_up', '识别回踩拒跌低延迟顺势形态');

  // 智能布林墙：干净大实体上破放行，带长上影阻滞的极端超买拦截
  const bollMock = { mid: new Array(10).fill(3700), sd: new Array(10).fill(2.0) };
  const cleanBreak = Array.from({ length: 10 }, (_, idx) =>
    idx === 9 ? bar(100 + idx * 60, 3702.0, 3705.2, 3701.8, 3705.0) : bar(100 + idx * 60, 3700, 3701, 3699, 3700)
  );
  const rejectedTop = Array.from({ length: 10 }, (_, idx) =>
    idx === 9 ? bar(100 + idx * 60, 3702.0, 3707.5, 3701.8, 3704.8) : bar(100 + idx * 60, 3700, 3701, 3699, 3700)
  );
  assert(isBlockedByWall(cleanBreak, 9, 1, 2.0, bollMock) === false, '布林外沿干净大实体真突破不应被拦截');
  assert(isBlockedByWall(rejectedTop, 9, 1, 2.0, bollMock) === true, '布林极端外沿带长上影阻滞应被拦截');
}

// 11. xaudz 同方向重复触发不得强杀未平持仓
{
  state.mkt = 'xau';
  state.tf = '1m';
  const baseT = 1795017600;
  const bars = Array.from({ length: 100 }, (_, i) => {
    // 在第 95 根构造确认摆动低点 3698.6，使多单止损有充足结构缓冲，避免回踩时先打止损
    if (i === 95) return bar(baseT + i * 60, 3699.8, 3700.4, 3698.6, 3699.9);
    return bar(baseT + i * 60, 3700, 3700.5, 3699.5, 3700);
  });
  // 第 100 根：向上突破 EMA100 + 1ATR 触发做多
  bars.push(bar(baseT + 100 * 60, 3700, 3703.2, 3699.8, 3703.0));
  // 中间 6 根：跌回 EMA100 + 1ATR 下方但不触及原止损，也不触及 TP1
  for (let k = 1; k <= 6; k++) {
    const c = k === 6 ? 3700.9 : 3701.4;
    bars.push(bar(baseT + (100 + k) * 60, 3701.4, 3702.0, 3700.8, c));
  }
  // 第 107 根：再次强势收破 EMA100 + 1ATR（发出第二条同方向 xaudz 信号）
  bars.push(bar(baseT + 107 * 60, 3701.0, 3703.8, 3700.9, 3703.6));
  const rawSetups = findXaudzSetups(bars, bars.length - 1);
  assert(rawSetups.length === 2 && rawSetups[0].dir === 1 && rawSetups[1].dir === 1, '测试序列应产生两条同向 xaudz 原始信号');
  const plan = computePatternPlan(bars, null, (baseT + 109 * 60) * 1000, 'xaudz');
  assert(plan.active && plan.active.i === 100 && plan.history.length === 0, 'xaudz 持仓期间出现同向重复信号不得强杀旧单');
  assert(plan.marks.length === 1, '被忽略的同向重复信号不应重复写入 marks');
}

// 12. 宽影线触发防插针扩损时，止损仍受 +0.30 ATR 上限夹紧，且 TP1 与 SL 仍严格保持 1:1
{
  state.tf = '3m';
  state.mkt = 'xau';
  const baseT = Math.floor(Date.UTC(2026, 5, 1, 2, 0, 0) / 1000); // BJ 10:00 亚盘
  const klines = [];
  let pxVal = 3780;
  for (let i = 0; i < 36; i++) {
    const o = pxVal;
    const step = (i % 4 === 3) ? 0.30 : -0.55;
    const c = o + step;
    klines.push(bar(baseT + i * 180, o, Math.max(o, c) + 0.35, Math.min(o, c) - 0.35, c));
    pxVal = c;
  }
  const o36 = pxVal;
  const c36 = o36 + 1.6;
  klines.push(bar(baseT + 36 * 180, o36, c36 + 0.35, o36 - 0.15, c36));
  const o37 = c36;
  const c37 = o37 + 0.95;
  // 前一根带长上影，拉高形态极值，使结构止损触发上限夹紧
  klines.push(bar(baseT + 37 * 180, o37, c37 + 1.8, o37 - 0.15, c37));
  const o38 = c37 + 0.05;
  const c38 = o37 - 1.15;
  klines.push(bar(baseT + 38 * 180, o38, o38 + 0.2, c38 - 0.15, c38));
  const c39 = c38 - 0.2;
  klines.push(bar(baseT + 39 * 180, c38, c38 + 0.15, c39 - 0.1, c39));

  const plan = computePatternPlan(klines, { last: c39 }, Date.UTC(2026, 5, 1, 2, 33, 0), 'strict');
  assert(plan.active && plan.active.dir === -1 && plan.active.i === 38, '长影吞没序列应在第 38 根触发空头持仓');
  const distSl = plan.active.origSl - plan.active.entry;
  const distTp1 = plan.active.entry - plan.active.tp1;
  const maxSl = plan.active.atr * (SESSION_PROFILES.asia.slMult + 0.30);
  approx(distSl, maxSl, { tol: 1e-6, label: '长影线防插针止损应被上限夹紧在基础止损 + 0.30 ATR' });
  approx(distTp1, distSl, { tol: 1e-6, label: '触发结构扩损后 TP1 仍与止损保持 1:1' });
}

console.log('PASS pattern-plan');
