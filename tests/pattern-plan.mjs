import {
  SESSION_PROFILES,
  computePatternPlan,
  computeRangeFilter,
  detectBarPattern,
  formatSessionMults,
  sessionProfileForTs,
} from '../src/indicators/pattern.js';
import { state } from '../src/state.js';
import { approx, assert } from './_lib/assert.mjs';

function bar(t, o, h, l, c) {
  return { t: t, o: o, h: h, l: l, c: c };
}

// 1. 时段与倍数检查（北京时间）
{
  const asiaTs = Date.UTC(2026, 5, 1, 2, 30, 0); // BJ 10:30 -> 亚盘
  const eurTs = Date.UTC(2026, 5, 1, 8, 30, 0);  // BJ 16:30 -> 欧盘
  const ovlTs = Date.UTC(2026, 5, 1, 13, 30, 0); // BJ 21:30 -> 欧美重叠
  const usTs = Date.UTC(2026, 5, 1, 18, 30, 0);  // BJ 02:30 -> 美盘

  const sAsia = sessionProfileForTs(asiaTs);
  assert(sAsia.id === 'asia' && sAsia.name === '亚盘', '亚盘时段识别');
  assert(formatSessionMults(sAsia) === 'SL×1.8 | TP1×1.8 | TP2×3', '亚盘倍数格式与示例一致');

  assert(sessionProfileForTs(eurTs).id === 'europe', '欧盘时段识别');
  assert(sessionProfileForTs(ovlTs).id === 'overlap', '欧美重叠时段识别');
  assert(sessionProfileForTs(usTs).id === 'us', '美盘时段识别');
}

// 2. 经典 K 线形态识别单元测试
{
  const atrArr = new Array(10).fill(2.0);

  // 看涨吞没
  const bullEngulf = [
    bar(1, 3700, 3701, 3699, 3700),
    bar(2, 3700, 3700.5, 3698.2, 3698.6),
    bar(3, 3698.5, 3701.8, 3698.1, 3701.5),
  ];
  const p1 = detectBarPattern(bullEngulf, 2, atrArr);
  assert(p1 && p1.dir === 1 && p1.code === 'bull_engulf', '识别看涨吞没');

  // 看跌吞没
  const bearEngulf = [
    bar(1, 3700, 3701, 3699, 3700),
    bar(2, 3700, 3701.8, 3699.6, 3701.4),
    bar(3, 3701.5, 3701.9, 3698.2, 3698.5),
  ];
  const p2 = detectBarPattern(bearEngulf, 2, atrArr);
  assert(p2 && p2.dir === -1 && p2.code === 'bear_engulf', '识别看跌吞没');

  // 启明星
  const morningStar = [
    bar(1, 3705, 3705.5, 3701.5, 3702.0),
    bar(2, 3701.8, 3702.1, 3701.0, 3701.5),
    bar(3, 3701.7, 3704.8, 3701.5, 3704.2),
  ];
  const p3 = detectBarPattern(morningStar, 2, atrArr);
  assert(p3 && p3.dir === 1 && p3.code === 'morning_star', '识别启明星');

  // 黄昏之星
  const eveningStar = [
    bar(1, 3700, 3703.5, 3699.8, 3703.0),
    bar(2, 3703.2, 3704.0, 3702.9, 3703.4),
    bar(3, 3703.2, 3703.5, 3700.4, 3700.8),
  ];
  const p4 = detectBarPattern(eveningStar, 2, atrArr);
  assert(p4 && p4.dir === -1 && p4.code === 'evening_star', '识别黄昏之星');

  // 红三兵 / 三只乌鸦
  const soldiers = [
    bar(1, 3700, 3701.5, 3699.8, 3701.3),
    bar(2, 3701.3, 3702.9, 3701.1, 3702.7),
    bar(3, 3702.7, 3704.4, 3702.5, 3704.2),
  ];
  const p5 = detectBarPattern(soldiers, 2, atrArr);
  assert(p5 && p5.dir === 1 && p5.code === 'three_soldiers', '识别红三兵');

  const crows = [
    bar(1, 3705, 3705.2, 3703.5, 3703.7),
    bar(2, 3703.7, 3703.9, 3702.1, 3702.3),
    bar(3, 3702.3, 3702.5, 3700.6, 3700.8),
  ];
  const p6 = detectBarPattern(crows, 2, atrArr);
  assert(p6 && p6.dir === -1 && p6.code === 'three_crows', '识别三只乌鸦');

  // 锤子线 / 流星线
  const hammerBars = [
    bar(1, 3706, 3707, 3704, 3705),
    bar(2, 3705, 3705.5, 3703, 3703.5),
    bar(3, 3703.5, 3704, 3702, 3702.5),
    bar(4, 3702.5, 3703, 3701, 3701.8),
    bar(5, 3701.8, 3702.2, 3698.6, 3701.6),
  ];
  const p7 = detectBarPattern(hammerBars, 4, atrArr);
  assert(p7 && p7.dir === 1 && p7.code === 'hammer', '识别锤子线');

  const starBars = [
    bar(1, 3700, 3702, 3699, 3701),
    bar(2, 3701, 3703, 3700.5, 3702.5),
    bar(3, 3702.5, 3704, 3702, 3703.5),
    bar(4, 3703.5, 3705, 3703, 3704.2),
    bar(5, 3704.2, 3707.6, 3703.8, 3704.4),
  ];
  const p8 = detectBarPattern(starBars, 4, atrArr);
  assert(p8 && p8.dir === -1 && p8.code === 'shooting_star', '识别流星线');
}

// 3. 完整序列：空头趋势 + 亚盘看跌吞没 -> 产生空头订单，检查开仓/止损/TP1/TP2 与盈亏计算
{
  state.tf = '1m';
  state.mkt = 'xau';
  const baseT = Math.floor(Date.UTC(2026, 5, 1, 2, 0, 0) / 1000); // BJ 10:00 亚盘，远早于 2026-11
  const klines = [];
  let pxVal = 3760;
  for (let i = 0; i < 30; i++) {
    const o = pxVal;
    const c = o - 0.55;
    klines.push(bar(baseT + i * 60, o, o + 0.45, c - 0.45, c));
    pxVal = c;
  }
  // 倒数第 3 根：小阳反弹
  const p = klines[klines.length - 1].c;
  klines.push(bar(baseT + 30 * 60, p, p + 1.1, p - 0.2, p + 0.9));
  // 倒数第 2 根：大阴吞没，确认空头开单
  const k31o = p + 0.95;
  const k31c = p - 1.8;
  klines.push(bar(baseT + 31 * 60, k31o, k31o + 0.2, k31c - 0.2, k31c));
  // 最后一根：小幅下跌但尚未打到 TP1/TP2，用于验证持仓盈亏
  const k32c = k31c - 0.8;
  klines.push(bar(baseT + 32 * 60, k31c, k31c + 0.2, k32c - 0.1, k32c));

  const plan = computePatternPlan(klines, { last: k32c }, Date.UTC(2026, 5, 1, 2, 33, 0));
  assert(plan.ok, '样本充足时计算成功');
  assert(plan.session.id === 'asia', '当前时段为亚盘');
  assert(plan.trendDir === -1 && plan.trendLab === '空头趋势', '趋势方向为空头趋势');
  assert(plan.active && plan.active.dir === -1, '存在空头持仓订单');
  assert(plan.active.sl > plan.active.entry, '空单止损高于开仓价');
  assert(plan.active.tp1 < plan.active.entry && plan.active.tp2 < plan.active.tp1, '空单 TP1 < 开仓 且 TP2 < TP1');
  const distSl = plan.active.sl - plan.active.entry;
  const distTp1 = plan.active.entry - plan.active.tp1;
  const distTp2 = plan.active.entry - plan.active.tp2;
  approx(distTp1 / distSl, SESSION_PROFILES.asia.tp1Mult / SESSION_PROFILES.asia.slMult, { tol: 1e-6, label: '亚盘 TP1/SL 倍数比' });
  approx(distTp2 / distSl, SESSION_PROFILES.asia.tp2Mult / SESSION_PROFILES.asia.slMult, { tol: 1e-6, label: '亚盘 TP2/SL 倍数比' });
  assert(plan.pnlPts > 0 && plan.pnlPct > 0, '空单价格下跌时浮盈为正');
  assert(plan.marks.length >= 1, '输出图表开单标记');
}

// 4. 未收盘 K 线不提前确认开单，只给预备提示
{
  state.tf = '1m';
  const nowSec = Math.floor(Date.now() / 1000);
  const klines = [];
  let pxVal = 3700;
  for (let i = 0; i < 30; i++) {
    // 平稳微幅震荡，不触发任何形态
    const d = (i % 2 === 0 ? 0.1 : -0.1);
    klines.push(bar(nowSec - (30 - i) * 60, pxVal, pxVal + 0.18, pxVal - 0.18, pxVal + d));
    pxVal += d;
  }
  // 倒数第 2 根（已收盘小阴）
  klines.push(bar(nowSec - 65, 3700.5, 3700.8, 3699.7, 3699.8));
  // 最后一根（当前正在走，未收盘大阳吞没）
  klines.push(bar(nowSec - 10, 3699.7, 3702.6, 3699.5, 3702.4));

  const plan = computePatternPlan(klines, { last: 3702.4 });
  assert(!plan.active || plan.active.i < klines.length - 1, '未收盘棒不得确认开仓');
  assert(plan.forming && plan.forming.dir === 1, '未收盘大阳吞没应标出预备形态');
}

// 5. Range Filter 方向单调性基础校验
{
  const upCloses = Array.from({ length: 40 }, (_, i) => 3700 + i * 1.2);
  const rfUp = computeRangeFilter(upCloses, 14, 1.8);
  assert(rfUp.dir[rfUp.dir.length - 1] === 1, '持续上涨序列 RF 方向为多');
  const dnCloses = Array.from({ length: 40 }, (_, i) => 3750 - i * 1.2);
  const rfDn = computeRangeFilter(dnCloses, 14, 1.8);
  assert(rfDn.dir[rfDn.dir.length - 1] === -1, '持续下跌序列 RF 方向为空');
}

console.log('PASS pattern-plan');
