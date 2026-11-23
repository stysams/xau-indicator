import { computePatSr, getPatSr, normalizePatSrSide, normalizePatSrSource, patSrTitle } from '../src/indicators/pattern-sr.js';
import { judge } from '../src/judge/judge.js';
import { collectSignalEvents } from '../src/view/signal-rail.js';
import { state } from '../src/state.js';
import { assert, approx } from './_lib/assert.mjs';

const T0 = 1_700_000_000;

function bar(i, o, h, l, c, tOverride) {
  return {
    t: tOverride != null ? tOverride : (T0 + i * 60),
    o: o,
    h: Math.max(h, o, c),
    l: Math.min(l, o, c),
    c: c,
  };
}

// 按控制点线性插值生成平滑但峰谷唯一的 K 线序列
function fromAnchors(anchors, spread) {
  const sp = spread == null ? 0.14 : spread;
  const closes = [];
  for (let s = 0; s < anchors.length - 1; s++) {
    const [i0, p0] = anchors[s];
    const [i1, p1] = anchors[s + 1];
    const steps = i1 - i0;
    for (let k = 0; k < steps; k++) {
      closes[i0 + k] = p0 + (p1 - p0) * (k / steps);
    }
    closes[i1] = p1;
  }
  const bars = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const o = i === 0 ? c : closes[i - 1];
    const h = Math.max(o, c) + sp;
    const l = Math.min(o, c) - sp;
    bars.push(bar(i, o, h, l, c));
  }
  return bars;
}

async function formingBucketStart(spanSec) {
  let t = Math.floor(Date.now() / 1000 / spanSec) * spanSec;
  if (Date.now() >= t * 1000 + spanSec * 1000 - 1000) {
    await new Promise((r) => setTimeout(r, 1200));
    t = Math.floor(Date.now() / 1000 / spanSec) * spanSec;
  }
  return t;
}

const oldTf = state.tf;
const oldSource = state.patSrSource;
const oldSide = state.patSrSide;
const oldFac = Object.assign({}, state.fac);
state.tf = '1m';
state.patSrSource = 'all';
state.patSrSide = 'both';
state.fac.patSr = true;

try {
  // --- 0. 参数规范化与样本不足 ---
  assert(normalizePatSrSource('struct') === 'struct', 'source=struct');
  assert(normalizePatSrSource('bad') === 'all', 'invalid source falls back to all');
  assert(normalizePatSrSide('sup') === 'sup', 'side=sup');
  assert(normalizePatSrSide('bad') === 'both', 'invalid side falls back to both');

  const shortPack = computePatSr([bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100)]);
  assert(!shortPack.ok && shortPack.levels.length === 0 && shortPack.vote === 0, '样本不足应返回空包');

  // --- 1. W底（双底）识别、颈线识别与收盘上破颈线顶底转换 ---
  {
    const wb = fromAnchors([
      [0, 105], [8, 100], [16, 104.2], [24, 100.1], [32, 103.4], [38, 102.8],
    ], 0.12);
    const pack = computePatSr(wb, { source: 'struct', side: 'both' });
    assert(pack.ok, 'W底结构应被识别: ' + pack.why);
    assert(pack.shapes.some((s) => s.code === 'double_bottom'), '应检出 W底 形状');
    const baseSup = pack.levels.find((lv) => lv.codes.indexOf('double_bottom') >= 0);
    const neckRes = pack.levels.find((lv) => lv.codes.indexOf('double_bottom_neck') >= 0);
    assert(baseSup && baseSup.role === 'sup', 'W底底沿应为支撑位');
    approx(baseSup.price, 100.0, { atol: 0.4, label: 'W底支撑价' });
    assert(neckRes && neckRes.role === 'res', '未破位前 W底颈线应为压力位');
    approx(neckRes.price, 104.32, { atol: 0.45, label: 'W底颈线价' });
    assert(/支撑/.test(patSrTitle(baseSup, 103)), 'patSrTitle 支撑文案');

    // 收盘强力上破颈线 → 颈线由压力转换为支撑
    const broke = wb.concat([
      bar(39, 102.8, 104.8, 102.7, 104.7),
      bar(40, 104.7, 106.2, 104.6, 106.0),
    ]);
    const pBroke = computePatSr(broke, { source: 'struct', side: 'both' });
    const flippedNeck = pBroke.levels.find((lv) => lv.codes.indexOf('double_bottom_neck') >= 0);
    assert(flippedNeck && flippedNeck.structRole === 'sup' && flippedNeck.flipCount >= 1,
      'W底颈线收盘上破后应转为支撑');
    assert(flippedNeck.breakDir === 1 && pBroke.vote === 1, '上破颈线应给多头破位票');
    assert(pBroke.events.some((ev) => ev.eventType === 'break' && ev.dir === 1), '信号线事件应记录上破颈线');
  }

  // --- 2. M顶（双顶）识别与收盘下破颈线顶底转换 ---
  {
    const mt = fromAnchors([
      [0, 96], [8, 105], [16, 100.6], [24, 104.9], [32, 101.8], [38, 102.2],
    ], 0.12);
    const pack = computePatSr(mt, { source: 'struct', side: 'both' });
    assert(pack.ok, 'M顶结构应被识别: ' + pack.why);
    assert(pack.shapes.some((s) => s.code === 'double_top'), '应检出 M顶 形状');
    const topRes = pack.levels.find((lv) => lv.codes.indexOf('double_top') >= 0);
    const neckSup = pack.levels.find((lv) => lv.codes.indexOf('double_top_neck') >= 0);
    assert(topRes && topRes.role === 'res', 'M顶顶沿应为压力位');
    assert(neckSup && neckSup.role === 'sup', '未破位前 M顶颈线应为支撑位');

    const broke = mt.concat([
      bar(39, 102.2, 102.3, 99.8, 99.9),
      bar(40, 99.9, 100.0, 98.4, 98.6),
    ]);
    const pBroke = computePatSr(broke, { source: 'struct', side: 'both' });
    const flippedNeck = pBroke.levels.find((lv) => lv.codes.indexOf('double_top_neck') >= 0);
    assert(flippedNeck && flippedNeck.structRole === 'res' && flippedNeck.flipCount >= 1,
      'M顶颈线收盘跌破后应转为压力');
    assert(pBroke.vote === -1, '跌破 M顶颈线应给空头破位票');
  }

  // --- 3. 三重底识别 ---
  {
    const tb = fromAnchors([
      [0, 105], [7, 100], [14, 104.2], [21, 100.1], [28, 104.0], [35, 100.05], [43, 103.5],
    ], 0.12);
    const pack = computePatSr(tb, { source: 'struct', side: 'both' });
    assert(pack.ok && pack.shapes.some((s) => s.code === 'triple_bottom'), '应检出三重底形态');
    const lv = pack.levels.find((x) => x.codes.indexOf('triple_bottom') >= 0);
    assert(lv && lv.role === 'sup', '三重底底沿应为支撑位');
  }

  // --- 4. 收敛三角形与上升支撑趋势线 ---
  {
    const tri = fromAnchors([
      [0, 104], [6, 108], [13, 100], [20, 106.8], [27, 101.2], [34, 105.6], [41, 102.4], [46, 104.0],
    ], 0.10);
    const pack = computePatSr(tri, { source: 'struct', side: 'both' });
    assert(pack.ok, '收敛三角形应有输出');
    assert(pack.trendlines.some((t) => t.code === 'triangle_sup' && t.slope > 0), '应检出收敛三角下沿支撑线');
    assert(pack.trendlines.some((t) => t.code === 'triangle_res' && t.slope < 0), '应检出收敛三角上沿压力线');

    // 仅支撑模式不应返回压力趋势线与压力带
    const supOnly = computePatSr(tri, { source: 'struct', side: 'sup' });
    assert(supOnly.levels.every((lv) => lv.role !== 'res'), '仅支撑模式不应包含压力水平位');
    assert(supOnly.trendlines.every((tl) => tl.role !== 'res'), '仅支撑模式不应包含压力趋势线');
  }

  // --- 5. 反转 K 线形态支撑带（看涨吞没、扫低收回、锤子线）+ A6 十字星不误判 ---
  {
    const bars = [];
    for (let i = 0; i < 24; i++) {
      const c = 104 - i * 0.12;
      bars.push(bar(i, c + 0.15, c + 0.25, c - 0.15, c));
    }
    // 第 24 根大阴线，第 25 根看涨吞没
    bars.push(bar(24, 101.1, 101.15, 100.3, 100.4));
    bars.push(bar(25, 100.38, 101.45, 100.25, 101.35));
    // 随后几根维持在上方
    bars.push(bar(26, 101.35, 101.7, 101.2, 101.6));
    bars.push(bar(27, 101.6, 101.9, 101.4, 101.8));
    bars.push(bar(28, 101.8, 102.1, 101.6, 102.0));

    const pack = computePatSr(bars, { source: 'candle', side: 'both' });
    assert(pack.ok, '看涨吞没应形成支撑带: ' + pack.why);
    const eng = pack.levels.find((lv) => lv.codes.indexOf('bull_engulf') >= 0);
    assert(eng && eng.role === 'sup', '看涨吞没应标记为支撑带');

    // 纯十字星（o === c）不应误判为锤子线（遵循 A6 口径）
    const dojiBars = [];
    for (let i = 0; i < 24; i++) {
      const c = 105 - i * 0.10;
      dojiBars.push(bar(i, c + 0.08, c + 0.20, c - 0.12, c));
    }
    dojiBars.push(bar(24, 102.5, 102.55, 101.6, 102.5));
    dojiBars.push(bar(25, 102.5, 102.8, 102.45, 102.75));
    const dojiPack = computePatSr(dojiBars, { source: 'candle', side: 'both' });
    assert(!dojiPack.levels.some((lv) => lv.codes.indexOf('hammer') >= 0), '纯十字星不应误判为锤子线');
  }

  // --- 6. 结构 + K线共振合并 ---
  {
    const wb = fromAnchors([
      [0, 105], [8, 100], [16, 104.2], [23, 100.45], [24, 100.05], [32, 103.6], [38, 103.0],
    ], 0.10);
    // 在右底 24-25 注入清晰看涨吞没，与 W底底沿共振
    wb[24] = bar(24, 100.45, 100.50, 99.95, 100.02);
    wb[25] = bar(25, 100.00, 100.90, 99.92, 100.82);
    const pack = computePatSr(wb, { source: 'all', side: 'both' });
    assert(pack.ok, '共振样本应成功识别');
    const conf = pack.levels.find((lv) => lv.codes.indexOf('double_bottom') >= 0);
    assert(conf && conf.confluence >= 2 && conf.categories.indexOf('struct') >= 0 && conf.categories.indexOf('candle') >= 0,
      'W底与看涨吞没在同价区应共振合并: ' + JSON.stringify(conf && { name: conf.name, confluence: conf.confluence, cats: conf.categories }));
  }

  // --- 7. 严格收盘确认：未收盘 K 线破位不翻转、不出票 ---
  {
    const wb = fromAnchors([
      [0, 105], [8, 100], [16, 104.2], [24, 100.1], [32, 103.4], [38, 101.5],
    ], 0.12);
    const tForm = await formingBucketStart(60);
    const live = wb.concat([bar(39, 101.5, 101.6, 97.0, 97.2, tForm)]);
    const pLive = computePatSr(live, { source: 'struct', side: 'both' });
    const lvLive = pLive.levels.find((lv) => lv.codes.indexOf('double_bottom') >= 0);
    assert(lvLive && lvLive.flipCount === 0, '未收盘大阴穿底不应触发顶底转换');
    assert(pLive.vote === 0, '未收盘破位不应给出方向票: vote=' + pLive.vote);

    const closed = wb.concat([bar(39, 101.5, 101.6, 97.0, 97.2, T0 + 39 * 60)]);
    const pClosed = computePatSr(closed, { source: 'struct', side: 'both' });
    const lvClosed = pClosed.levels.find((lv) => lv.codes.indexOf('double_bottom') >= 0);
    assert(lvClosed && lvClosed.flipCount >= 1 && lvClosed.structRole === 'res', '同一根收盘后应确认跌破并转为压力');
    assert(pClosed.vote === -1, '同一根收盘跌破后应给出空票');
  }

  // --- 8. 缓存键一致性 + judge / signal-rail 接入 ---
  {
    const wb = fromAnchors([
      [0, 105], [8, 100], [16, 104.2], [24, 100.1], [32, 103.4], [38, 102.8],
    ], 0.12).concat([
      bar(39, 102.8, 104.8, 102.7, 104.7),
      bar(40, 104.7, 106.2, 104.6, 106.0),
    ]);
    state._patSrKey = '';
    state._patSr = null;
    state.patSrSource = 'all';
    state.patSrSide = 'both';
    const a = getPatSr(wb);
    assert(getPatSr(wb) === a, '同参数应命中缓存');
    state.patSrSide = 'sup';
    const b = getPatSr(wb);
    assert(b !== a && b.side === 'sup', '切换 side 应失效缓存并重算');
    state.patSrSource = 'struct';
    const c = getPatSr(wb);
    assert(c !== b && c.source === 'struct', '切换 source 应失效缓存并重算');

    state.patSrSource = 'all';
    state.patSrSide = 'both';
    state.fac.patSr = true;
    const j = judge(wb, { last: 106.0 }, {});
    assert(j.factors.some((f) => f.id === 'patSr'), 'judge 启用 patSr 时应包含形态支撑因子');
    const sigs = collectSignalEvents(wb);
    assert(sigs.some((e) => e.kind === 'patSr'), 'collectSignalEvents 应收集形态支撑事件');

    state.fac.patSr = false;
    const jOff = judge(wb, { last: 106.0 }, {});
    assert(!jOff.factors.some((f) => f.id === 'patSr'), '关闭 patSr 因子后 judge 不应输出');
    const sigsOff = collectSignalEvents(wb);
    assert(!sigsOff.some((e) => e.kind === 'patSr'), '关闭 patSr 因子后信号线应过滤形态支撑事件');
  }
} finally {
  state.tf = oldTf;
  state.patSrSource = oldSource;
  state.patSrSide = oldSide;
  state.fac = oldFac;
  state._patSrKey = '';
  state._patSr = null;
}

console.log('PASS pattern-sr');
