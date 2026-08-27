import { pbClosedEnd } from '../core/bars.js';
import { atrFallback, px } from '../core/format.js';
import { atr } from '../core/math.js';
import { state } from '../state.js';

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const FIB_EXT = [1.272, 1.618];

export const FIB_KEYS = [0.382, 0.5, 0.618, 0.786];

export function fibLook(tf) {
  if (tf === '10s') return { k: 6, minAtr: 1.7, minBars: 8, look: 90, pxFloor: 0.00012 };
  if (tf === '1m') return { k: 4, minAtr: 1.5, minBars: 6, look: 80, pxFloor: 0.00018 };
  if (tf === '5m' || tf === '15m') return { k: 3, minAtr: 1.4, minBars: 5, look: 64, pxFloor: 0.00025 };
  return { k: 2, minAtr: 1.3, minBars: 4, look: 48, pxFloor: 0.00035 };
}

export function fibNear(a, b) {
  return Math.abs(a - b) < 1e-9;
}

export function fibIsKey(r) {
  return FIB_KEYS.some((x) => fibNear(x, r));
}

export function fibRatioText(r) {
  if (fibNear(r, 0)) return '0';
  if (fibNear(r, 1)) return '1';
  if (fibNear(r, 0.236)) return '0.236';
  if (fibNear(r, 0.382)) return '0.382';
  if (fibNear(r, 0.5)) return '0.5';
  if (fibNear(r, 0.618)) return '0.618';
  if (fibNear(r, 0.786)) return '0.786';
  if (fibNear(r, 1.272)) return '1.272';
  if (fibNear(r, 1.618)) return '1.618';
  return String(r);
}

export function fibEmpty() {
  return {
    ok: false, dir: 0, start: null, end: null, span: 0,
    atrv: 0, radius: 0, levels: [], retrace: null, hit: null, hitR: null,
    kind: 'none', status: 'none', vote: 0,
    label: '斐波那契未现', title: '斐波那契未现', name: '斐波那契',
    why: '近端没有足够大的摆动，画不出斐波那契回撤。',
    forming: false, points: [],
  };
}

export function fibPivots(klines, k, from, to) {
  const raw = [];
  const start = Math.max(k, from);
  const last = to - k;
  for (let i = start; i <= last; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= k; j++) {
      if (!(klines[i].h > klines[i - j].h && klines[i].h >= klines[i + j].h)) isH = false;
      if (!(klines[i].l < klines[i - j].l && klines[i].l <= klines[i + j].l)) isL = false;
    }
    if (isH && isL) continue;
    if (isH) raw.push({ i: i, kind: 'h', price: klines[i].h });
    else if (isL) raw.push({ i: i, kind: 'l', price: klines[i].l });
  }
  const alt = [];
  for (let r = 0; r < raw.length; r++) {
    const p = raw[r];
    if (!alt.length) { alt.push(p); continue; }
    const lastP = alt[alt.length - 1];
    if (p.kind === lastP.kind) {
      if (p.kind === 'h' && p.price >= lastP.price) alt[alt.length - 1] = p;
      if (p.kind === 'l' && p.price <= lastP.price) alt[alt.length - 1] = p;
    } else {
      alt.push(p);
    }
  }
  return alt;
}

export function fibZigZag(pivots, minMove, minBars) {
  const zz = [];
  for (let i = 0; i < pivots.length; i++) {
    const p = pivots[i];
    if (!zz.length) { zz.push(p); continue; }
    const last = zz[zz.length - 1];
    if (p.kind === last.kind) {
      if (p.kind === 'h' && p.price >= last.price) zz[zz.length - 1] = p;
      if (p.kind === 'l' && p.price <= last.price) zz[zz.length - 1] = p;
      continue;
    }
    if (Math.abs(p.price - last.price) < minMove) continue;
    if (p.i - last.i < minBars) continue;
    zz.push(p);
  }
  return zz;
}

export function fibLevelPx(endPx, startPx, r) {
  return endPx + (startPx - endPx) * r;
}

export function fibHoldBar(bar, level, dir, radius, thresh) {
  if (!bar) return false;
  const rng = bar.h - bar.l;
  if (rng < radius * 0.35) return false;
  if (dir > 0) {
    // 必须真正探到或穿过 level，不允许最低点停在支撑上方虚探
    const wick = bar.l <= level && bar.l >= level - radius * 1.8;
    const held = bar.c >= level - thresh * 0.25 && bar.c > bar.l + radius * 0.25;
    const notThrough = Math.min(bar.o, bar.c) >= level - thresh * 1.2;
    return wick && held && notThrough;
  }
  const wick = bar.h >= level && bar.h <= level + radius * 1.8;
  const held = bar.c <= level + thresh * 0.25 && bar.h > bar.c + radius * 0.25;
  const notThrough = Math.max(bar.o, bar.c) <= level + thresh * 1.2;
  return wick && held && notThrough;
}

export function computeFib(klines) {
  const empty = fibEmpty();
  if (!klines || klines.length < 18) return empty;
  const cfg = fibLook(state.tf);
  const closedEnd = pbClosedEnd(klines);
  const lastI = klines.length - 1;
  const forming = closedEnd < lastI;
  const last = klines[lastI];
  const voteBar = klines[Math.max(0, closedEnd)];
  const lastPx = last.c;
  const atrv = atr(klines, 14) || atrFallback(lastPx);
  const minMove = Math.max(atrv * cfg.minAtr, lastPx * (cfg.pxFloor || 0.00018));
  const radius = Math.max(atrv * 0.22, lastPx * 0.00012);
  const thresh = Math.max(atrv * 0.18, lastPx * 0.0001);
  const from = Math.max(0, closedEnd + 1 - cfg.look);
  const pivots = fibPivots(klines, cfg.k, from, closedEnd);
  let zz = fibZigZag(pivots, minMove, cfg.minBars);
  if (zz.length) {
    const tail = zz[zz.length - 1];
    if (tail.kind === 'h') {
      let extI = tail.i, extP = tail.price;
      for (let i = tail.i + 1; i <= lastI; i++) {
        if (klines[i].h >= extP) { extP = klines[i].h; extI = i; }
      }
      if (extI !== tail.i) zz[zz.length - 1] = { i: extI, kind: 'h', price: extP, running: true };
    } else {
      let extI = tail.i, extP = tail.price;
      for (let i = tail.i + 1; i <= lastI; i++) {
        if (klines[i].l <= extP) { extP = klines[i].l; extI = i; }
      }
      if (extI !== tail.i) zz[zz.length - 1] = { i: extI, kind: 'l', price: extP, running: true };
    }
  }
  if (zz.length < 2) {
    let hiI = from, loI = from, hi = -Infinity, lo = Infinity;
    for (let i = from; i <= lastI; i++) {
      if (klines[i].h >= hi) { hi = klines[i].h; hiI = i; }
      if (klines[i].l <= lo) { lo = klines[i].l; loI = i; }
    }
    if (!(hi - lo >= minMove) || hiI === loI) return empty;
    zz = hiI > loI
      ? [{ i: loI, kind: 'l', price: lo }, { i: hiI, kind: 'h', price: hi }]
      : [{ i: hiI, kind: 'h', price: hi }, { i: loI, kind: 'l', price: lo }];
  }

  const legs = [];
  for (let i = 1; i < zz.length; i++) {
    const A = zz[i - 1], B = zz[i];
    const span = Math.abs(B.price - A.price);
    if (span < minMove) continue;
    if (B.i - A.i < cfg.minBars) continue;
    const dir = B.kind === 'h' ? 1 : -1;
    const retrace = dir * (B.price - lastPx) / span;
    legs.push({ A: A, B: B, span: span, dir: dir, retrace: retrace });
  }
  if (!legs.length) return empty;

  function fibScore(leg) {
    const r = leg.retrace;
    let s = 0;
    if (r >= 0.28 && r <= 0.9) s += 6;
    else if (r >= -0.06 && r <= 1.12) s += 2;
    else return -1;
    s += Math.min(3, leg.span / minMove);
    s += leg.B.i / Math.max(1, lastI) * 1.2;
    if (FIB_KEYS.some((x) => Math.abs(r - x) <= 0.07)) s += 1.5;
    return s;
  }
  legs.forEach((leg) => { leg.score = fibScore(leg); });
  const ranked = legs.filter((x) => x.score >= 0).sort((a, b) => b.score - a.score);
  const wave = ranked[0];
  if (!wave) return empty;

  const start = wave.A, end = wave.B, dir = wave.dir, span = wave.span;
  const retrace = wave.retrace;
  const levels = FIB_RATIOS.map((r) => ({
    r: r,
    price: fibLevelPx(end.price, start.price, r),
    key: fibIsKey(r),
    ext: false,
  }));
  FIB_EXT.forEach((r) => {
    const price = fibLevelPx(end.price, start.price, r);
    const near = Math.abs(lastPx - price) <= Math.max(atrv * 2.4, span * 0.35);
    if (near || retrace <= 0.12) {
      levels.push({ r: r, price: price, key: fibNear(r, 1.618), ext: true });
    }
  });

  const keyLv = levels.filter((lv) => lv.key && !lv.ext);
  function testLevel(bar) {
    let best = null, bestDist = Infinity;
    keyLv.forEach((lv) => {
      const wick = dir > 0 ? bar.l : bar.h;
      const dist = Math.abs(wick - lv.price);
      if (dist < bestDist && fibHoldBar(bar, lv.price, dir, radius, thresh)) {
        best = lv;
        bestDist = dist;
      }
    });
    return best;
  }

  let hit = null;
  let kind = 'idle';
  let status = 'idle';
  let vote = 0;
  let why = '';
  let label = '斐波那契 ' + (dir > 0 ? '涨势回撤' : '跌势反抽');
  let name = '斐波那契';
  const failClosed = dir > 0
    ? voteBar.c < start.price - thresh
    : voteBar.c > start.price + thresh;
  const failForm = forming && (dir > 0 ? last.c < start.price - thresh : last.c > start.price + thresh);
  const sliced = (voteBar.h - voteBar.l) > span * 0.28;

  if (failClosed && retrace >= 0.86) {
    kind = 'fail';
    status = 'trigger';
    vote = -dir;
    name = '斐波那契失效';
    label = dir > 0 ? '跌破 100%' : '升破 100%';
    why = (dir > 0 ? '收盘跌破涨势 100% 起点 ' : '收盘升破跌势 100% 起点 ') +
      px(start.price) + '，原段斐波那契失效。只描述结构，不是下单指令。';
  } else if (failForm && retrace >= 0.86) {
    kind = 'fail';
    status = 'watch';
    vote = 0;
    name = '斐波那契';
    label = '100% 预备';
    why = '正在走的那根穿过 100% 起点，收盘后才确认原段是否失效。';
  } else if (!sliced) {
    const closedHit = testLevel(voteBar);
    const formHit = forming ? testLevel(last) : null;
    if (closedHit) {
      hit = closedHit;
      kind = 'hold';
      status = 'trigger';
      vote = dir;
      name = dir > 0 ? '斐波那契回踩' : '斐波那契反抽';
      label = (dir > 0 ? '回踩 ' : '反抽 ') + fibRatioText(closedHit.r);
      why = (dir > 0 ? '涨势回撤到 ' : '跌势反抽到 ') + fibRatioText(closedHit.r) +
        '（' + px(closedHit.price) + '）后收回。只描述位置，不是下单指令。';
    } else if (formHit) {
      hit = formHit;
      kind = 'hold';
      status = 'watch';
      vote = 0;
      name = '斐波那契';
      label = fibRatioText(formHit.r) + ' 预备';
      why = '正在走的那根碰到 ' + fibRatioText(formHit.r) +
        '（' + px(formHit.price) + '），收盘后才确认。';
    }
  }

  if (!why) {
    if (retrace < 0.22) {
      why = dir > 0 ? '涨势回撤还浅，还没到 0.382。' : '跌势反抽还浅，还没到 0.382。';
    } else if (retrace > 1.02) {
      why = '现价已经越过 100% 起点，原段斐波那契参考意义下降。';
    } else {
      const nearLv = keyLv.slice().sort((a, b) => Math.abs(lastPx - a.price) - Math.abs(lastPx - b.price))[0];
      why = '现价回撤约 ' + Math.round(Math.max(0, Math.min(1, retrace)) * 100) +
        '%，贴近 ' + (nearLv ? fibRatioText(nearLv.r) + '（' + px(nearLv.price) + '）' : '分割位') +
        '，观察是否守住。';
      if (nearLv) hit = nearLv;
      label = '贴近 ' + (nearLv ? fibRatioText(nearLv.r) : '分割位');
    }
  }

  return {
    ok: true, dir: dir, start: start, end: end, span: span,
    atrv: atrv, radius: radius, levels: levels, retrace: retrace, hit: hit,
    hitR: hit ? hit.r : null,
    kind: kind, status: status, vote: vote, why: why, label: label,
    title: label, name: name, forming: forming,
    points: [
      { i: start.i, price: start.price, lab: '100%' },
      { i: end.i, price: end.price, lab: '0%' },
    ],
  };
}

export function getFib(klines) {
  const last = klines[klines.length - 1];
  const key = [klines.length, last && last.t, last && last.c, last && last.h, last && last.l, state.tf].join(':');
  if (state._fibKey === key && state._fib) return state._fib;
  const pack = computeFib(klines);
  state._fibKey = key;
  state._fib = pack;
  return pack;
}
