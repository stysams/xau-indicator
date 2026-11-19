import { kdjOf, tdxSma } from '../src/core/math.js';
import {
  DIV3_FRESH,
  classifyDiv3Marks,
  computeDiv3,
  crossIndexes,
  divergenceEvents,
  getDiv3,
  guideHeader,
  guideLine,
  mergeTriple,
  rsiLongPeriod,
  scanDiv3,
} from '../src/indicators/div3.js';
import { state } from '../src/state.js';
import { approx, assert } from './_lib/assert.mjs';

function bar(t, o, h, l, c) {
  return { t: t, o: o, h: h, l: l, c: c };
}

function filled(n, v) {
  return new Array(n).fill(v);
}

function run(arr, from, to, v) {
  for (let i = from; i <= to; i++) arr[i] = v;
}

function rawMark(i, dir) {
  return {
    i: i,
    dir: dir,
    legs: {
      macd: { pricePrevI: i - 12, pricePrev: 100, priceNowI: i - 3, priceNow: dir > 0 ? 90 : 110 },
      kdj: { i: i },
      rsi: { i: i },
    },
  };
}

// --- KDJ：N=3，通达信 SMA，初值 50 ---
{
  const klines = [
    bar(1, 9, 10, 8, 9),
    bar(2, 10, 11, 9, 10),
    bar(3, 11, 12, 9, 11),
    bar(4, 10, 12, 10, 10),
    bar(5, 10.2, 11, 10, 10.5),
  ];
  const kd = kdjOf(klines, 3, 3, 3);
  assert(kd.k[0] == null && kd.k[1] == null, 'KDJ 窗口未满时留空');
  approx(kd.rsv[2], 75, { label: 'RSV[2]' });
  approx(kd.rsv[3], 100 / 3, { label: 'RSV[3]' });
  approx(kd.rsv[4], 50, { label: 'RSV[4]' });
  approx(kd.k[2], 175 / 3, { label: 'K[2] 从 50 起步' });
  approx(kd.k[3], 50, { label: 'K[3]' });
  approx(kd.k[4], 50, { label: 'K[4]' });
  approx(kd.d[2], 475 / 9, { label: 'D[2]' });
  approx(kd.d[3], 1400 / 27, { label: 'D[3]' });
  approx(kd.d[4], 4150 / 81, { label: 'D[4]' });
  approx(kd.j[4], 3850 / 81, { label: 'J[4]' });
  approx(tdxSma([null, 10], 3, 1, 50)[1], (10 + 100) / 3, { label: 'tdxSma 跳过空值' });
}

{
  assert(rsiLongPeriod(6) === 12, 'RSI6 配 12');
  assert(rsiLongPeriod(9) === 18, 'RSI9 配 18');
  assert(rsiLongPeriod(14) === 24, 'RSI14 配 24');
}

// --- 单指标背离：三次同向交叉，后段价格更低、指标更高 ---
{
  const price = filled(31, 110);
  const ind = filled(31, 5);
  run(price, 1, 10, 100);
  run(price, 11, 20, 105);
  run(price, 21, 30, 95);
  run(ind, 1, 10, -8);
  run(ind, 11, 20, -3);
  run(ind, 21, 30, -1);
  const hits = divergenceEvents(price, ind, [0, 10, 20, 30], 1);
  assert(hits.length === 1, '只有后一段价格创新低: ' + hits.length);
  approx(hits[0].i, 30, { label: '背离触发在最后一次交叉' });
  approx(hits[0].priceNow, 95, { label: '后段价格低点' });
  approx(hits[0].indNow, -1, { label: '后段指标低点更高' });

  const tooClose = divergenceEvents(price, ind, [10, 12, 14], 1);
  assert(tooClose.length === 0, '间隔小于 3 根不算一段');

  const flatInd = ind.slice();
  run(flatInd, 21, 30, -3);
  const tied = divergenceEvents(price, flatInd, [0, 10, 20, 30], 1);
  assert(!tied.some((ev) => ev.i === 30), '指标低点没有抬高，不算底背离');
}

{
  const fast = filled(10, -1);
  const slow = filled(10, 0);
  run(fast, 4, 7, 1);
  fast[8] = -1;
  fast[9] = 1;
  const up = crossIndexes(fast, slow, 1);
  const down = crossIndexes(fast, slow, -1);
  assert(up.join(',') === '4,9', '金叉下标: ' + up.join(','));
  assert(down.join(',') === '8', '死叉下标: ' + down.join(','));
}

{
  function ev(i) {
    return { i: i, dir: 1, pricePrevI: 1, pricePrev: 10, priceNowI: 2, priceNow: 9, indNow: 2, indPrev: 1 };
  }
  const synced = mergeTriple({ macd: [ev(30)], kdj: [ev(31)], rsi: [ev(34)] }, 1, 5);
  assert(synced.length === 1 && synced[0].i === 34, '5 根内三指标合成一次');
  const apart = mergeTriple({ macd: [ev(30)], kdj: [ev(30)], rsi: [ev(40)] }, 1, 5);
  assert(apart.length === 0, '超出 5 根不同步，不叫三维');
  const pair = mergeTriple({ macd: [ev(30)], kdj: [ev(30)], rsi: [] }, 1, 5);
  assert(pair.length === 0, '只有两项不是三维');
}

{
  const fresh = classifyDiv3Marks([rawMark(30, 1)], 36);
  assert(fresh.status === 'trigger' && fresh.vote === 1, '8 根内的三维底背离给多票');
  assert(36 - 30 <= DIV3_FRESH, '新鲜窗口边界');
  const edge = classifyDiv3Marks([rawMark(28, 1)], 36);
  assert(edge.status === 'trigger' && edge.vote === 1, '刚好 8 根仍算当段');
  const stale = classifyDiv3Marks([rawMark(20, -1)], 40);
  assert(stale.status === 'stale' && stale.vote === 0 && stale.dir === -1, '离开触发根后不再给票');
  const pending = classifyDiv3Marks([rawMark(30, 1), rawMark(40, 1)], 36);
  assert(pending.status === 'watch' && pending.vote === 0, '未收盘的共振只预备、不计票');
  assert(pending.marks[pending.marks.length - 1].lab === '三维底预备', '预备标签');
}

// 三个指标共用同一组交叉，价格后段创新低、指标低点抬高。
function bottomInput(n, closedEnd, rsiDiverges) {
  const dif = filled(n, 1);
  const dea = filled(n, 0);
  run(dif, 8, 11, -8);
  dif[12] = 1;
  run(dif, 18, 23, -3);
  dif[24] = 1;
  run(dif, 30, 35, -1);
  dif[36] = 1;
  const rsi1 = dif.slice();
  if (!rsiDiverges) run(rsi1, 30, 35, -6);
  const lows = filled(n, 110);
  run(lows, 18, 23, 105);
  run(lows, 30, 35, 95);
  return {
    lows: lows,
    highs: filled(n, 120),
    dif: dif,
    dea: dea,
    k: dif.slice(),
    d: dea.slice(),
    rsi1: rsi1,
    rsi2: dea.slice(),
    closedEnd: closedEnd,
    lastIndex: n - 1,
    rsiN: 14,
    rsiLong: 24,
  };
}

{
  const live = scanDiv3(bottomInput(41, 40, true));
  assert(live.ok && live.status === 'trigger' && live.vote === 1, '三维底背离计多票: ' + live.status + '/' + live.vote);
  assert(live.marks.length === 1 && live.marks[0].i === 36 && live.marks[0].status === 'trigger', '标记落在最后一次共振交叉');
  approx(live.marks[0].extremePx, 95, { label: '连线用后段价格低点' });
  assert(live.why.indexOf('不是下单指令') >= 0, '说明不写成下单指令');
  assert(live.legs.every((lg) => lg.active && lg.dir === 1), '三项都记成有效底背离');
  assert(live.guides.length === 3 && live.guides.every((g) => g.ready && g.diverged && g.dir === 1), '辅助段同时标出三项底背离');
  assert(guideHeader(live.guides) === '分项 3/3', '分项计数满额');

  const stale = scanDiv3(bottomInput(51, 50, true));
  assert(stale.status === 'stale' && stale.vote === 0 && stale.dir === 0, '变旧后方向票撤销，旗帜也不再当作当前方向');
  assert(stale.marks.some((mk) => mk.i === 36 && mk.status === 'trigger'), '旧标记仍留在图上');

  const watch = scanDiv3(bottomInput(41, 35, true));
  assert(watch.status === 'watch' && watch.vote === 0, '交叉落在未收盘根上只预备');
  assert(watch.marks[0].status === 'watch' && watch.marks[0].lab === '三维底预备', '预备文案');

  const partial = scanDiv3(bottomInput(41, 40, false));
  assert(partial.status === 'none' && partial.vote === 0 && partial.marks.length === 0, 'RSI 没背离就不构成三维');
  assert(partial.legs[0].active && partial.legs[1].active && !partial.legs[2].active, '状态条保留已经背离的两项');
  assert(partial.why.indexOf('没有形成三维背离') >= 0, '未形成要写明');
  const rsiG = partial.guides.find((g) => g.id === 'rsi');
  assert(rsiG && rsiG.ready && !rsiG.diverged && rsiG.priceOk && !rsiG.indOk, 'RSI 辅助段标明价格新低但指标也新低');
  assert(guideLine(rsiG).indexOf('指标也新低') >= 0, '未背离文案');
  assert(partial.guides.filter((g) => g.id !== 'rsi').every((g) => g.diverged), '另外两项辅助段仍然背离');
  assert(guideHeader(partial.guides) === '分项 2/3', '缺一项时分项 2/3');
}

{
  const n = 41;
  const dif = filled(n, -1);
  const dea = filled(n, 0);
  run(dif, 8, 11, 8);
  dif[12] = -1;
  run(dif, 18, 23, 3);
  dif[24] = -1;
  run(dif, 30, 35, 1);
  dif[36] = -1;
  const highs = filled(n, 100);
  run(highs, 18, 23, 100);
  run(highs, 30, 35, 110);
  const top = scanDiv3({
    lows: filled(n, 80),
    highs: highs,
    dif: dif,
    dea: dea,
    k: dif.slice(),
    d: dea.slice(),
    rsi1: dif.slice(),
    rsi2: dea.slice(),
    closedEnd: 40,
    lastIndex: 40,
    rsiN: 14,
    rsiLong: 24,
  });
  assert(top.status === 'trigger' && top.vote === -1, '三维顶背离计空票: ' + top.status + '/' + top.vote);
  assert(top.marks[0].lab === '三维顶背离', '顶背离标签');
  approx(top.marks[0].extremePx, 110, { label: '顶背离用后段高点' });
  assert(top.guides.every((g) => g.diverged && g.dir === -1 && g.lab === (g.tag + '顶')), '顶背离辅助段');
}

{
  state.tf = '1m';
  state.rsiN = 14;
  state._div3Key = '';
  const bars = [];
  for (let i = 0; i < 80; i++) {
    const c = 100 + i * 0.4;
    bars.push(bar(1700000000 + i * 60, c - 0.1, c + 0.2, c - 0.2, c));
  }
  const smooth = computeDiv3(bars);
  assert(smooth.ok, '够长的单边样本可以计算');
  assert(smooth.vote === 0 && smooth.marks.length === 0, '严格抬升不应造出三维背离');
  assert(smooth.guides.length === 3, '没有共振时也给出三项辅助状态');
  assert(smooth.rsiLong === 24, '默认 RSI14 配长周期 24');

  const shortPack = computeDiv3(bars.slice(0, 20));
  assert(!shortPack.ok && shortPack.vote === 0, '样本不足不计票');

  state._div3Key = '';
  const cached = getDiv3(bars);
  const again = getDiv3(bars);
  assert(cached === again, '同一根 K 与同一 RSI 周期走缓存');
  state.rsiN = 6;
  const switched = getDiv3(bars);
  assert(switched !== cached && switched.rsiLong === 12, '改 RSI 周期后重算，长周期改成 12');
  state.rsiN = 14;
  state._div3Key = '';
}

console.log('PASS div3');
