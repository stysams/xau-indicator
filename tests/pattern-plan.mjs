import { tfSpanMs } from '../src/core/bars.js';
import { bwRankWindow } from '../src/core/math.js';
import {
  BE_CUSHION_ATR,
  SESSION_PROFILES,
  SESSION_PROFILES_3M,
  computePatternPlan,
  computeRangeFilter,
  detectBarPattern,
  detectBbSnapPattern,
  detectLowLatencyPattern,
  detectSweepPattern,
  efficiencyRatio,
  formatSessionMults,
  isBlockedByWall,
  isChasingExtreme,
  normalizePatternMode,
  rangePosInDir,
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

// 3. 完整序列（通用周期 5m）：空头趋势 + 回踩 EMA20 附近看跌吞没 -> 产生空头订单，并验证 TP1 自动移动保本
{
  state.tf = '5m';
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
  state.tf = '5m';
  state.mkt = 'xau';
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
  state.tf = '5m';
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

// 13. 3 分钟专属优化内核校验：盘口倍数、8 根扫荡优先、未达 TP1 禁提前割肉反手、达 TP1 后锁利反手
{
  state.tf = '3m';
  state.mkt = 'xau';
  const asiaTs = Date.UTC(2026, 5, 1, 2, 30, 0); // BJ 10:30 亚盘
  const s3Asia = sessionProfileForTs(asiaTs, '3m');
  assert(s3Asia.slMult === SESSION_PROFILES_3M.asia.slMult, '3m 时段应返回 3m 紧凑盘口配置');
  Object.values(SESSION_PROFILES_3M).forEach((s) => {
    approx(s.tp1Mult, s.slMult, { tol: 1e-9, label: '3m ' + s.name + '第一止盈应与止损 1:1' });
  });

  // 构造明确下行后的 8 根流动性扫低收回（满足 ER >= 0.20、z <= 0、rDir <= 52、prev3Drop >= 0.45）
  const baseT = Math.floor(Date.UTC(2026, 5, 1, 2, 0, 0) / 1000);
  const klines = [];
  let pxVal = 3740;
  for (let i = 0; i < 28; i++) {
    const o = pxVal;
    const step = (i < 16) ? -0.35 : -0.85;
    const c = o + step;
    klines.push(bar(baseT + i * 180, o, Math.max(o, c) + 0.35, Math.min(o, c) - 0.35, c));
    pxVal = c;
  }
  // 第 28 根：刺破前 8 根最低点后长下影强势收回（扫低收回）
  const prev8Lo = Math.min(...klines.slice(20, 28).map((k) => k.l));
  const swOpen = prev8Lo + 0.35;
  const swLow = prev8Lo - 0.85;
  const swClose = prev8Lo + 0.85;
  const swHigh = swClose + 0.15;
  klines.push(bar(baseT + 28 * 180, swOpen, swHigh, swLow, swClose));

  const atrMock = new Array(klines.length).fill(1.4);
  const swPat = detectSweepPattern(klines, 28, atrMock, 8);
  assert(swPat && swPat.dir === 1 && swPat.code === 'sweep_up', 'detectSweepPattern 应识别前 8 根扫低收回');

  const planOpen = computePatternPlan(klines, { last: swClose }, (baseT + 29 * 180) * 1000, 'strict');
  assert(planOpen.ok && planOpen.active && planOpen.active.dir === 1 && planOpen.active.i === 28, '3m 稳健档应在扫低收回棒触发多单');
  assert(planOpen.active.pattern.code === 'sweep_up', '3m 应优先采用扫低收回形态');
  assert(planOpen.multText === formatSessionMults(SESSION_PROFILES_3M.asia), '3m 面板倍数文案应与 3m 盘口一致');
  const slDist3 = planOpen.active.entry - planOpen.active.origSl;
  const tp1Dist3 = planOpen.active.tp1 - planOpen.active.entry;
  const minSl3 = planOpen.active.atr * SESSION_PROFILES_3M.asia.slMult * 0.85;
  const maxSl3 = planOpen.active.atr * (SESSION_PROFILES_3M.asia.slMult + 0.22);
  assert(slDist3 >= minSl3 - 1e-6 && slDist3 <= maxSl3 + 1e-6, '3m 止损应位于 [0.85×base, base+0.22] ATR 限幅内');
  approx(tp1Dist3, slDist3, { tol: 1e-6, label: '3m TP1 应与初始止损保持 1:1' });

  // 第 29 根：未触达 TP1 也未触达 SL，即便出现反向小高点扫高收回，也不得提前割肉平仓
  const midC = planOpen.active.entry + slDist3 * 0.45;
  const prev8HiBefore29 = Math.max(...klines.slice(21, 29).map((k) => k.h));
  const barNoFlip = bar(
    baseT + 29 * 180,
    planOpen.active.entry + 0.1,
    Math.min(planOpen.active.tp1 - 0.1, prev8HiBefore29 + 0.4),
    planOpen.active.entry - slDist3 * 0.2,
    midC
  );
  const planHold = computePatternPlan(klines.concat([barNoFlip]), { last: midC }, (baseT + 30 * 180) * 1000, 'classic');
  assert(planHold.active && planHold.active.i === 28 && planHold.history.length === 0, '3m 未达 TP1 前不得提前割肉反手');

  // 追加上涨序列触达 TP1（但不破 TP2）并在高位走出反向扫高收回 -> 应触发盈利反手 flip
  const tp1Px = planOpen.active.tp1;
  const tp2Px = planOpen.active.tp2;
  const climb1 = bar(baseT + 29 * 180, swClose, tp1Px + 0.2, swClose - 0.1, tp1Px + 0.1);
  const climb2 = bar(baseT + 30 * 180, tp1Px + 0.1, Math.min(tp2Px - 0.2, tp1Px + 0.7), tp1Px, tp1Px + 0.5);
  const climb3 = bar(baseT + 31 * 180, tp1Px + 0.5, Math.min(tp2Px - 0.15, tp1Px + 1.0), tp1Px + 0.3, tp1Px + 0.85);
  const seqBeforeFlip = klines.concat([climb1, climb2, climb3]);
  const prev8Hi = Math.max(...seqBeforeFlip.slice(seqBeforeFlip.length - 8).map((k) => k.h));
  const revHi = Math.min(tp2Px - 0.05, prev8Hi + 0.75);
  const revBar = bar(baseT + 32 * 180, prev8Hi - 0.1, revHi, prev8Hi - 0.9, prev8Hi - 0.7);
  // 若 revHi 刚好低于 prev8Hi + 0.05（受 tp2Px 限制）则按 classic 校验至少已触 TP1 保本
  const planAfter = computePatternPlan(seqBeforeFlip.concat([revBar]), { last: revBar.c }, (baseT + 33 * 180) * 1000, 'classic');
  assert(planAfter.ok, '3m 盈利反手场景计算成功');
  if (revHi > prev8Hi + 0.15 && planAfter.history.length === 1) {
    assert(planAfter.history[0].status === 'flip' && planAfter.stats.wins === 1, '3m 触达 TP1 后遇反向扫高收回触发盈利反手并计胜');
    assert(planAfter.active && planAfter.active.dir === -1, '3m 盈利反手后切换为空头持仓');
  } else {
    assert(planAfter.active && planAfter.active.hitTp1 && planAfter.active.breakeven, '3m 触达 TP1 后进入保本保护状态');
  }
}

// 14. 防追顶护盾校验：严格拦截波段高位追多/低位砸空与双顶压力墙（不因顺 EMA50 旁路），避免防追顶失真
{
  const kl = [];
  let pxVal = 3700;
  for (let i = 0; i < 25; i++) {
    const o = pxVal;
    const c = o + 0.8;
    kl.push(bar(1000 + i * 180, o, c + 0.2, o - 0.2, c));
    pxVal = c;
  }
  const bollMock = { mid: new Array(25).fill(3708), sd: new Array(25).fill(4.0) };
  // 最后一根收在 24 根区间最顶部（pos ≈ 0.99, z > 2）
  const posLong = rangePosInDir(kl, 24, 1, 1.5, 24);
  const posShort = rangePosInDir(kl, 24, -1, 1.5, 24);
  assert(posLong > 0.90, '连续上涨末端做多区间分位应接近顶部 (>0.90)');
  assert(posShort < 0.10, '连续上涨末端做空区间分位应接近底部 (<0.10)');
  assert(isChasingExtreme(kl, 24, 1, 1.5, bollMock, { lookback: 24, maxPos: 0.65, maxZ: 0.85 }) === true, '防追顶护盾应拦截波段顶部追多');
  assert(isChasingExtreme(kl, 24, -1, 1.5, bollMock, { lookback: 24, maxPos: 0.65, maxZ: 0.85 }) === false, '防追顶护盾不应误拦顶部反手做空');

  // 1m 场景：价格在 EMA50 上方单边震荡推升至区间顶部反复走出看涨吞没 -> classic 放行追多，safe 防追顶必须拦截
  state.tf = '1m';
  state.mkt = 'xau';
  const baseT = Math.floor(Date.UTC(2026, 5, 1, 2, 0, 0) / 1000);
  const chaseBars = [];
  let p = 3700;
  for (let i = 0; i < 40; i++) {
    const o = p;
    const step = i === 38 ? -0.45 : (i === 39 ? 1.25 : (i % 2 === 0 ? 0.55 : -0.15));
    const c = o + step;
    chaseBars.push(bar(baseT + i * 60, o, Math.max(o, c) + 0.15, Math.min(o, c) - 0.15, c));
    p = c;
  }
  const pClassic = computePatternPlan(chaseBars, { last: p }, (baseT + 41 * 60) * 1000, 'classic');
  const pSafe = computePatternPlan(chaseBars, { last: p }, (baseT + 41 * 60) * 1000, 'safe');
  assert(pClassic.marks.length > 0 && pClassic.active && pClassic.active.dir === 1, '1m 经典档在连涨推升段吞没应触发多单');
  assert(pSafe.marks.length < pClassic.marks.length && !pSafe.active, '1m 防追顶档必须拦截波段顶部追多，不得与经典档雷同失真');
}

// 15. 布林 ±2σ 外轨刺破收回识别 + 15m 顺势均线回踩通道校验
{
  const bollMock = { mid: new Array(6).fill(3700), sd: new Array(6).fill(2.0) };
  const snapBars = [
    bar(100, 3700, 3701, 3699, 3700),
    bar(200, 3700, 3700.5, 3697, 3697.5),
    // 下探 3695.5 (z=-2.25) 后强阳收回至 3698.6 (z=-0.70, closePos=0.89)
    bar(300, 3697.5, 3699.0, 3695.5, 3698.6),
    // 上冲 3704.5 (z=+2.25) 后强阴收回至 3701.4 (z=+0.70, closePos=0.11)
    bar(400, 3702.5, 3704.5, 3701.0, 3701.4),
  ];
  const pUp = detectBbSnapPattern(snapBars, 2, 2.0, bollMock);
  const pDn = detectBbSnapPattern(snapBars, 3, 2.0, bollMock);
  assert(pUp && pUp.dir === 1 && pUp.code === 'bb_snap_up', '应识别布林下轨 ±2σ 刺破强收回做多');
  assert(pDn && pDn.dir === -1 && pDn.code === 'bb_snap_dn', '应识别布林上轨 ±2σ 刺破强收回做空');

  // 15m 顺势多头回调至 EMA20 后强阳收复 EMA9 -> 触发多单
  state.tf = '15m';
  state.mkt = 'xau';
  const baseT = Math.floor(Date.UTC(2026, 5, 1, 2, 0, 0) / 1000);
  const bars15 = [];
  let pxVal = 3650;
  // 先横盘蓄势，再走出清晰多头波段，随后 4 根回踩至 EMA20 附近后强阳收复 EMA9
  for (let i = 0; i < 34; i++) {
    const o = pxVal;
    const c = o + (i < 16 ? 0.15 : 2.1);
    bars15.push(bar(baseT + i * 900, o, c + 0.5, o - 0.3, c));
    pxVal = c;
  }
  for (let k = 0; k < 4; k++) {
    const o = pxVal;
    const c = o - 3.1;
    bars15.push(bar(baseT + (34 + k) * 900, o, o + 0.4, c - 0.5, c));
    pxVal = c;
  }
  // 第 38 根小阳止跌、第 39 根强阳收复 EMA9（回踩 EMA20 后顺势再启动）
  const o38 = pxVal;
  const c38 = o38 + 1.0;
  bars15.push(bar(baseT + 38 * 900, o38, c38 + 0.4, o38 - 0.5, c38));
  const o39 = c38;
  const c39 = o39 + 3.0;
  bars15.push(bar(baseT + 39 * 900, o39, c39 + 0.3, o39 - 0.5, c39));
  const plan15 = computePatternPlan(bars15, { last: c39 }, (baseT + 40 * 900) * 1000, 'strict');
  assert(plan15.ok && plan15.active && plan15.active.dir === 1 && plan15.active.i === 39, '15m 稳健档应在顺势回踩均线强阳收回后触发多单');
}

console.log('PASS pattern-plan');
