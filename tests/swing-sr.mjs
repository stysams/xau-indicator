import { pivotPoints, significantPivots } from '../src/core/math.js';
import {
  computeSr,
  srBreakMeta,
  srLevelZone,
  srTouchMeta,
  srWaveRange,
} from '../src/indicators/sr.js';
import { state } from '../src/state.js';
import { approx, assert } from './_lib/assert.mjs';

function bar(i, o, h, l, c) {
  return { t: i * 60, o: o, h: h, l: l, c: c };
}

function flatBars(closes) {
  return closes.map((c, i) => bar(i, c, c + 0.2, c - 0.2, c));
}

// 已确认枢轴：中心高点需要左右各两根较低高点，末尾两根不能提前确认。
{
  const bars = [
    bar(0, 1, 2, 0.8, 1.5),
    bar(1, 2, 3, 1.8, 2.5),
    bar(2, 3, 6, 2.8, 5.5),
    bar(3, 4, 5, 3.8, 4.5),
    bar(4, 3, 4, 2.8, 3.5),
    bar(5, 4, 7, 3.8, 6.5),
    bar(6, 5, 6, 4.8, 5.5),
  ];
  const pivots = pivotPoints(bars, 2);
  assert(pivots.some((p) => p.kind === 'h' && p.i === 2 && p.price === 6), '中心高点应在右侧两根完成后确认');
  assert(!pivots.some((p) => p.i > bars.length - 3), '末尾未获得两根右侧 K 线的点不能确认');
}

// ZigZag 口径：高低点必须交替，小于最小反转的噪声忽略，同类保留更极端者。
{
  const raw = [
    { i: 1, kind: 'l', price: 100 },
    { i: 2, kind: 'h', price: 100.4 },
    { i: 3, kind: 'l', price: 99.8 },
    { i: 4, kind: 'h', price: 101.2 },
    { i: 5, kind: 'h', price: 101.5 },
    { i: 6, kind: 'l', price: 100.9 },
    { i: 7, kind: 'l', price: 100.0 },
  ];
  const out = significantPivots(raw, 1);
  assert(out.length === 3, '显著摆动应剩三点: ' + out.length);
  assert(out[0].i === 3 && out[1].i === 5 && out[2].i === 7, '应保留交替的极端点');
  assert(out[0].kind === 'l' && out[1].kind === 'h' && out[2].kind === 'l', '显著摆动必须高低交替');
}

// 当前腿达到最小反转后才显示，并明确当前终点尚未确认。
{
  const pivots = [
    { i: 1, kind: 'l', price: 100 },
    { i: 4, kind: 'h', price: 104 },
    { i: 7, kind: 'l', price: 101 },
  ];
  const activeBars = flatBars([101, 100.2, 102, 103, 103.8, 103, 102, 101.2, 102, 104, 105]);
  activeBars[1].l = 100;
  activeBars[4].h = 104;
  activeBars[7].l = 101;
  activeBars[10].h = 105;
  const active = srWaveRange(activeBars, pivots, 2, 2.5);
  assert(active && active.status === 'forming' && active.dir === 1, '应识别达到门槛的上涨进行中波段');
  assert(active.loConfirmed && !active.hiConfirmed, '上涨波段只确认起点低点');
  approx(active.lo, 101, { label: '进行中波段低点' });
  approx(active.hi, 105, { label: '进行中波段高点' });

  const quietBars = flatBars([101, 100.2, 102, 103, 103.8, 103, 102, 101.2, 101.5, 102, 102.2]);
  quietBars[1].l = 100;
  quietBars[4].h = 104;
  quietBars[7].l = 101;
  const completed = srWaveRange(quietBars, pivots, 2, 2.5);
  assert(completed && completed.status === 'confirmed' && completed.dir === -1, '小幅当前腿应继续显示最近已完成下跌波段');
  assert(completed.hiConfirmed && completed.loConfirmed, '已完成波段两端都必须确认');
}

// 支压区域宽度受 ATR 半径约束，不把价格簇错误扩成无限宽区域。
{
  const zone = srLevelZone({ price: 100, spread: 1 }, 2);
  approx(zone.half, 1.1, { label: '支压区域半宽' });
  approx(zone.lo, 98.9, { label: '支压区域下沿' });
  approx(zone.hi, 101.1, { label: '支压区域上沿' });
}

// 连续 K 线接触合并为一次；间隔后的拒绝和新枢轴分别计数。
{
  const bars = flatBars([102, 100, 100.2, 102, 102, 102, 102, 100, 102]);
  bars[4] = bar(4, 102, 102.2, 100.5, 102);
  const cluster = {
    price: 100, spread: 0.4, firstI: 1, lastI: 7,
    pivots: [{ i: 1, kind: 'l', price: 100 }, { i: 2, kind: 'l', price: 100.2 }, { i: 7, kind: 'l', price: 100 }],
  };
  const meta = srTouchMeta(bars, cluster, { lo: 99, hi: 101 }, 2);
  assert(meta.touches === 3, '相邻触碰去重后应为三组: ' + meta.touches);
  assert(meta.rejections === 1, '应识别一组从区域收回的拒绝');
  assert(meta.lastI === 7, '近期性应取最后一次独立触碰');
}

// 影线越界不算破位；收盘离开整个区域加缓冲才破位，并可再次角色互换。
{
  const bars = [
    bar(0, 101, 102, 100, 101),
    bar(1, 101, 102, 99, 101),
    bar(2, 100, 101, 98, 99.2),
    bar(3, 99, 100, 98, 98.4),
    bar(4, 99, 101, 98.8, 100),
    bar(5, 100, 102, 99.8, 101.6),
    bar(6, 101.6, 102, 101, 101.8),
  ];
  const meta = srBreakMeta(bars, { lastI: 1, orig: 'sup' }, { lo: 99, hi: 101 }, 0.5);
  assert(meta.events.length === 2, '应先跌破支撑，再升破转换压力');
  assert(meta.events[0].i === 3 && meta.events[0].dir === -1, '首次破位必须由收盘低于区域下沿加缓冲确认');
  assert(meta.breakI === 5 && meta.breakDir === 1, '最近一次角色互换应为向上突破');
  assert(meta.role === 'sup', '再次上破后该区域应恢复为支撑');
}

// 混合高低点簇从最近一次枢轴的角色开始，不受历史多数类型干扰。
{
  const bars = [
    bar(0, 100, 101, 99, 100),
    bar(1, 100, 101, 99, 100),
    bar(2, 100, 102, 99.8, 101.6),
    bar(3, 101.6, 102, 101, 101.8),
  ];
  const meta = srBreakMeta(bars, { lastI: 1, orig: 'sup', lastRole: 'res' }, { lo: 99, hi: 101 }, 0.5);
  assert(meta.events.length === 1 && meta.breakDir === 1, '最近枢轴为高点时应从压力角色开始识别向上突破');
}

// 集成输出必须携带可绘制区域与波段状态。
{
  const oldTf = state.tf;
  const oldMkt = state.mkt;
  const oldTicker = state.ticker;
  state.tf = '15m';
  state.mkt = 'xau';
  state.ticker = null;
  const bars = [];
  for (let i = 0; i < 72; i++) {
    const phase = i % 12;
    const c = phase <= 6 ? 100 + phase : 106 - (phase - 6);
    bars.push(bar(i, c, c + 0.15, c - 0.15, c));
  }
  const pack = computeSr(bars);
  assert(pack.swing && pack.swing.range > 0, '集成输出应包含显著波段');
  assert(pack.levels.length > 0, '集成输出应包含支压区域');
  pack.levels.forEach((lv) => {
    assert(lv.zoneLo < lv.price && lv.zoneHi > lv.price, '每个支压位都应携带区域边界');
    assert(lv.lastTouchI != null, '每个支压位都应携带最后触碰时间');
  });
  state.tf = oldTf;
  state.mkt = oldMkt;
  state.ticker = oldTicker;
}

console.log('PASS swing-sr');
