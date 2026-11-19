import { pbClosedEnd } from '../core/bars.js';
import { kdjOf, macdOf, rsiSeries } from '../core/math.js';
import { state } from '../state.js';

export const DIV3_MIN_BARS = 48;
export const DIV3_MIN_GAP = 3;
export const DIV3_MAX_GAP = 120;
export const DIV3_SYNC = 5;
export const DIV3_FRESH = 8;
export const DIV3_LEG_WINDOW = 12;
export const DIV3_MARK_KEEP = 6;

export function rsiLongPeriod(short) {
  const n = Number(short) || 14;
  if (n === 6) return 12;
  if (n === 9) return 18;
  return 24;
}

export function crossIndexes(fast, slow, dir) {
  const out = [];
  const n = Math.min(fast ? fast.length : 0, slow ? slow.length : 0);
  for (let i = 1; i < n; i++) {
    const a0 = fast[i - 1];
    const b0 = slow[i - 1];
    const a1 = fast[i];
    const b1 = slow[i];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if (dir > 0 && a0 <= b0 && a1 > b1) out.push(i);
    else if (dir < 0 && a0 >= b0 && a1 < b1) out.push(i);
  }
  return out;
}

function segExtreme(series, from, to, dir) {
  let v = null;
  let idx = -1;
  const start = from + 1;
  if (!series || start > to) return { v: null, i: -1 };
  for (let i = start; i <= to; i++) {
    const x = series[i];
    if (x == null || !Number.isFinite(x)) continue;
    if (v == null || (dir > 0 ? x <= v : x >= v)) {
      v = x;
      idx = i;
    }
  }
  return { v: v, i: idx };
}

// 同向交叉至少三次后，比较相邻两段极值。
// 底背离：后段价格更低，指标更高。顶背离相反。交叉本身是触发点。
export function divergenceEvents(price, ind, crosses, dir) {
  const out = [];
  const list = crosses || [];
  for (let n = 2; n < list.length; n++) {
    const i = list[n];
    const j = list[n - 1];
    const h = list[n - 2];
    if (i - j < DIV3_MIN_GAP || i - j > DIV3_MAX_GAP) continue;
    if (j - h < DIV3_MIN_GAP || j - h > DIV3_MAX_GAP) continue;
    const priceNow = segExtreme(price, j, i, dir);
    const pricePrev = segExtreme(price, h, j, dir);
    const indNow = segExtreme(ind, j, i, dir);
    const indPrev = segExtreme(ind, h, j, dir);
    if (priceNow.v == null || pricePrev.v == null || indNow.v == null || indPrev.v == null) continue;
    const priceOk = dir > 0 ? priceNow.v < pricePrev.v : priceNow.v > pricePrev.v;
    const indOk = dir > 0 ? indNow.v > indPrev.v : indNow.v < indPrev.v;
    if (!priceOk || !indOk) continue;
    out.push({
      i: i, prev: j, older: h, dir: dir,
      priceNow: priceNow.v, priceNowI: priceNow.i,
      pricePrev: pricePrev.v, pricePrevI: pricePrev.i,
      indNow: indNow.v, indPrev: indPrev.v,
    });
  }
  return out;
}

function nearestEvent(list, index, sync) {
  let best = null;
  let bestDist = sync + 1;
  (list || []).forEach((ev) => {
    const dist = Math.abs(ev.i - index);
    if (dist <= sync && dist < bestDist) {
      best = ev;
      bestDist = dist;
    }
  });
  return best;
}

export function mergeTriple(legs, dir, sync) {
  const names = ['macd', 'kdj', 'rsi'];
  const lists = names.map((id) => (legs && legs[id]) || []);
  const marks = [];
  const seen = Object.create(null);
  lists.forEach((list, anchorAt) => {
    list.forEach((anchor) => {
      const picked = [null, null, null];
      picked[anchorAt] = anchor;
      let ok = true;
      for (let other = 0; other < 3; other++) {
        if (other === anchorAt) continue;
        const hit = nearestEvent(lists[other], anchor.i, sync);
        if (!hit) {
          ok = false;
          break;
        }
        picked[other] = hit;
      }
      if (!ok) return;
      const idxs = picked.map((ev) => ev.i);
      const signalI = Math.max(idxs[0], idxs[1], idxs[2]);
      const firstI = Math.min(idxs[0], idxs[1], idxs[2]);
      if (signalI - firstI > sync) return;
      const key = dir + ':' + signalI;
      if (seen[key]) return;
      seen[key] = true;
      marks.push({
        i: signalI,
        dir: dir,
        legs: { macd: picked[0], kdj: picked[1], rsi: picked[2] },
      });
    });
  });
  marks.sort((a, b) => a.i - b.i);
  return marks;
}

function markLab(dir, status) {
  const side = dir > 0 ? '三维底' : '三维顶';
  return status === 'watch' ? side + '预备' : side + '背离';
}

function presentMark(raw, status) {
  const macd = raw.legs.macd;
  return {
    i: raw.i,
    dir: raw.dir,
    status: status,
    anchorI: macd.pricePrevI,
    anchorPx: macd.pricePrev,
    extremeI: macd.priceNowI,
    extremePx: macd.priceNow,
    lab: markLab(raw.dir, status),
  };
}

export function classifyDiv3Marks(rawMarks, closedEnd) {
  const triggers = [];
  let watch = null;
  (rawMarks || []).forEach((raw) => {
    if (raw.i <= closedEnd) triggers.push(presentMark(raw, 'trigger'));
    else watch = presentMark(raw, 'watch');
  });
  const drawn = triggers.slice(-DIV3_MARK_KEEP);
  if (watch) drawn.push(watch);
  const newestTrigger = triggers.length ? triggers[triggers.length - 1] : null;
  const newest = watch && (!newestTrigger || watch.i > newestTrigger.i) ? watch : newestTrigger;
  let status = 'none';
  let dir = 0;
  let vote = 0;
  if (newest && newest.status === 'watch') {
    status = 'watch';
    dir = newest.dir;
  } else if (newestTrigger) {
    const fresh = closedEnd - newestTrigger.i <= DIV3_FRESH;
    status = fresh ? 'trigger' : 'stale';
    dir = newestTrigger.dir;
    if (fresh) vote = newestTrigger.dir;
  }
  return { marks: drawn, status: status, dir: dir, vote: vote, fresh: newestTrigger };
}

function guideTag(id) {
  if (id === 'macd') return 'M';
  if (id === 'kdj') return 'K';
  return 'R';
}

// 最近一次能够比较的同向交叉，不论有没有背离。辅助线用它说明指标正在看哪一段。
export function latestAttempt(price, ind, crosses, dir, id, name) {
  const list = crosses || [];
  const tag = guideTag(id);
  for (let n = list.length - 1; n >= 2; n--) {
    const i = list[n];
    const j = list[n - 1];
    const h = list[n - 2];
    if (i - j < DIV3_MIN_GAP || i - j > DIV3_MAX_GAP) continue;
    if (j - h < DIV3_MIN_GAP || j - h > DIV3_MAX_GAP) continue;
    const priceNow = segExtreme(price, j, i, dir);
    const pricePrev = segExtreme(price, h, j, dir);
    const indNow = segExtreme(ind, j, i, dir);
    const indPrev = segExtreme(ind, h, j, dir);
    if (priceNow.v == null || pricePrev.v == null || indNow.v == null || indPrev.v == null) continue;
    const priceOk = dir > 0 ? priceNow.v < pricePrev.v : priceNow.v > pricePrev.v;
    const indOk = dir > 0 ? indNow.v > indPrev.v : indNow.v < indPrev.v;
    return {
      id: id, name: name, tag: tag, dir: dir, i: i, ready: true,
      diverged: !!(priceOk && indOk), priceOk: priceOk, indOk: indOk,
      anchorI: pricePrev.i, anchorPx: pricePrev.v,
      extremeI: priceNow.i, extremePx: priceNow.v,
      indPrev: indPrev.v, indNow: indNow.v,
      lab: tag + (dir > 0 ? '底' : '顶'),
    };
  }
  return {
    id: id, name: name, tag: tag, dir: 0, i: -1, ready: false,
    diverged: false, priceOk: false, indOk: false, crosses: list.length,
    anchorI: -1, anchorPx: null, extremeI: -1, extremePx: null,
    lab: tag,
  };
}

export function pickGuide(bottom, top) {
  if (bottom && bottom.ready && top && top.ready) return bottom.i >= top.i ? bottom : top;
  if (bottom && bottom.ready) return bottom;
  if (top && top.ready) return top;
  return bottom || top;
}

export function guideLine(g) {
  const name = (g && g.name) || '指标';
  if (!g || !g.ready) return name + ' 交叉不足';
  if (g.diverged) return name + (g.dir > 0 ? ' 底背离' : ' 顶背离');
  const priceBit = g.priceOk
    ? (g.dir > 0 ? '价格新低' : '价格新高')
    : (g.dir > 0 ? '价格未新低' : '价格未新高');
  const indBit = g.indOk
    ? (g.dir > 0 ? '指标未新低' : '指标未新高')
    : (g.dir > 0 ? '指标也新低' : '指标也新高');
  return name + ' ' + priceBit + '，' + indBit;
}

export function guideHeader(guides) {
  const n = (guides || []).filter((g) => g && g.diverged).length;
  return '分项 ' + n + '/3';
}

function lastEvent(list) {
  return list && list.length ? list[list.length - 1] : null;
}

function newerEvent(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a.i >= b.i ? a : b;
}

function summarizeLeg(id, name, bottom, top, lastIndex) {
  const ev = newerEvent(lastEvent(bottom), lastEvent(top));
  if (!ev) return { id: id, name: name, dir: 0, i: -1, active: false };
  return {
    id: id,
    name: name,
    dir: ev.dir,
    i: ev.i,
    active: lastIndex - ev.i <= DIV3_LEG_WINDOW,
  };
}

function legPhrase(lg, lastIndex) {
  if (!lg || !lg.active || !lg.dir) return lg.name + '未背离';
  const age = lastIndex - lg.i;
  const side = lg.dir > 0 ? '底背离' : '顶背离';
  return lg.name + side + (age <= 0 ? '当根' : (age + '根前'));
}

function statusLab(status, dir) {
  if (status === 'trigger') return dir > 0 ? '三维底背离' : '三维顶背离';
  if (status === 'watch') return dir > 0 ? '三维底预备' : '三维顶预备';
  if (status === 'stale') return '背离已过';
  return '未形成';
}

function describe(status, dir, vote, fresh, legs, lastIndex) {
  const parts = (legs || []).map((lg) => legPhrase(lg, lastIndex)).join('，');
  if (status === 'trigger' && vote) {
    const side = dir > 0 ? '底背离' : '顶背离';
    const priceSide = dir > 0 ? '更低的低点' : '更高的高点';
    const indSide = dir > 0 ? '低' : '高';
    const cross = dir > 0 ? '金叉' : '死叉';
    return 'MACD、KDJ、RSI 在近 ' + DIV3_FRESH + ' 根内同时' + side +
      '：这段价格创出' + priceSide + '，三个指标都没有同步创新' + indSide +
      '，并且都完成了' + cross + '。只说明动能没有跟着价格走，不是下单指令。';
  }
  if (status === 'watch') {
    const side = dir > 0 ? '底背离' : '顶背离';
    return '三个指标在正在走的这根上凑齐' + side + '，收盘才确认。' + parts + '。';
  }
  if (status === 'stale' && fresh) {
    const age = lastIndex - fresh.i;
    const side = fresh.dir > 0 ? '底背离' : '顶背离';
    return '最近一次三维' + side + '在 ' + age + ' 根之前，已经离开触发根，不再给方向票。' + parts + '。';
  }
  return '近端没有形成三维背离。' + parts + '。价格新高或新低时，MACD、KDJ、RSI 需要一起不确认才标记。';
}

export function scanDiv3(input) {
  const src = input || {};
  const closedEnd = src.closedEnd == null ? -1 : src.closedEnd;
  const lastIndex = src.lastIndex == null ? closedEnd : src.lastIndex;
  const rsiN = src.rsiN || 14;
  const rsiLong = src.rsiLong || rsiLongPeriod(rsiN);
  const lows = src.lows || [];
  const highs = src.highs || [];
  const macdUp = crossIndexes(src.dif, src.dea, 1);
  const macdDn = crossIndexes(src.dif, src.dea, -1);
  const kdjUp = crossIndexes(src.k, src.d, 1);
  const kdjDn = crossIndexes(src.k, src.d, -1);
  const rsiUp = crossIndexes(src.rsi1, src.rsi2, 1);
  const rsiDn = crossIndexes(src.rsi1, src.rsi2, -1);
  const bottomLegs = {
    macd: divergenceEvents(lows, src.dif, macdUp, 1),
    kdj: divergenceEvents(lows, src.k, kdjUp, 1),
    rsi: divergenceEvents(lows, src.rsi1, rsiUp, 1),
  };
  const topLegs = {
    macd: divergenceEvents(highs, src.dif, macdDn, -1),
    kdj: divergenceEvents(highs, src.k, kdjDn, -1),
    rsi: divergenceEvents(highs, src.rsi1, rsiDn, -1),
  };
  const guides = [
    pickGuide(latestAttempt(lows, src.dif, macdUp, 1, 'macd', 'MACD'), latestAttempt(highs, src.dif, macdDn, -1, 'macd', 'MACD')),
    pickGuide(latestAttempt(lows, src.k, kdjUp, 1, 'kdj', 'KDJ'), latestAttempt(highs, src.k, kdjDn, -1, 'kdj', 'KDJ')),
    pickGuide(latestAttempt(lows, src.rsi1, rsiUp, 1, 'rsi', 'RSI' + rsiN), latestAttempt(highs, src.rsi1, rsiDn, -1, 'rsi', 'RSI' + rsiN)),
  ];
  const raw = mergeTriple(bottomLegs, 1, DIV3_SYNC).concat(mergeTriple(topLegs, -1, DIV3_SYNC));
  raw.sort((a, b) => a.i - b.i || b.dir - a.dir);
  const classified = classifyDiv3Marks(raw, closedEnd);
  const legs = [
    summarizeLeg('macd', 'MACD', bottomLegs.macd, topLegs.macd, lastIndex),
    summarizeLeg('kdj', 'KDJ', bottomLegs.kdj, topLegs.kdj, lastIndex),
    summarizeLeg('rsi', 'RSI' + rsiN, bottomLegs.rsi, topLegs.rsi, lastIndex),
  ];
  const why = describe(classified.status, classified.dir, classified.vote, classified.fresh, legs, lastIndex);
  const sig = [
    classified.status, classified.dir, classified.vote,
    classified.marks.map((mk) => mk.status + ':' + mk.dir + ':' + mk.i).join(','),
    guides.map((g) => [g.id, g.ready ? 1 : 0, g.diverged ? 1 : 0, g.dir, g.i].join(':')).join(','),
  ].join('|');
  return {
    ok: true,
    status: classified.status,
    statusLab: statusLab(classified.status, classified.dir),
    dir: classified.status === 'trigger' || classified.status === 'watch' ? classified.dir : 0,
    vote: classified.vote,
    label: statusLab(classified.status, classified.dir),
    title: '三维背离',
    why: why,
    marks: classified.marks,
    guides: guides,
    legs: legs,
    rsiN: rsiN,
    rsiLong: rsiLong,
    lastIndex: lastIndex,
    sig: sig,
  };
}

function emptyPack(rsiN, rsiLong, why) {
  return {
    ok: false, status: 'none', statusLab: '样本不足', dir: 0, vote: 0,
    label: '样本不足', title: '三维背离', why: why,
    marks: [], guides: [], legs: [], rsiN: rsiN, rsiLong: rsiLong, lastIndex: -1, sig: 'none',
  };
}

export function computeDiv3(klines) {
  const rsiN = state.rsiN || 14;
  const rsiLong = rsiLongPeriod(rsiN);
  if (!klines || klines.length < DIV3_MIN_BARS) {
    return emptyPack(rsiN, rsiLong, '三维背离至少需要 ' + DIV3_MIN_BARS + ' 根 K 线，MACD 预热后还要能比较相邻两段交叉。');
  }
  const closes = klines.map((k) => k.c);
  const macd = macdOf(closes);
  const kd = kdjOf(klines, 9, 3, 3);
  const closedEnd = pbClosedEnd(klines);
  return scanDiv3({
    lows: klines.map((k) => k.l),
    highs: klines.map((k) => k.h),
    dif: macd.dif,
    dea: macd.dea,
    k: kd.k,
    d: kd.d,
    rsi1: rsiSeries(closes, rsiN),
    rsi2: rsiSeries(closes, rsiLong),
    closedEnd: closedEnd,
    lastIndex: klines.length - 1,
    rsiN: rsiN,
    rsiLong: rsiLong,
  });
}

export function getDiv3(klines) {
  const last = klines && klines[klines.length - 1];
  const key = [
    klines && klines.length, last && last.t,
    last && last.o, last && last.h, last && last.l, last && last.c,
    state.tf, state.rsiN || 14,
  ].join(':');
  if (state._div3Key === key && state._div3) return state._div3;
  const pack = computeDiv3(klines);
  state._div3Key = key;
  state._div3 = pack;
  return pack;
}

export function formatDiv3Legs(pack) {
  if (!pack) return '';
  const lastIndex = pack.lastIndex == null ? 0 : pack.lastIndex;
  return (pack.legs || []).map((lg) => {
    if (!lg.active || !lg.dir) return lg.name + ' 未背离';
    const age = lastIndex - lg.i;
    const when = age <= 0 ? '当根' : (age + '根前');
    return lg.name + (lg.dir > 0 ? ' 底背离 ' : ' 顶背离 ') + when;
  }).join(' · ');
}
