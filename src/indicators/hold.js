import { pbClosedEnd } from '../core/bars.js';
import { atrFallback, n, px } from '../core/format.js';
import { atr, ema } from '../core/math.js';
import { fibHoldBar } from './fib.js';
import { getSr } from './sr.js';
import { state } from '../state.js';

export function holdEmpty() {
  return {
    ok: false, vote: 0, dir: 0, status: 'none',
    label: '企稳未现', title: '企稳未现',
    why: '近端没有影线探到支撑、均线或前低后收盘守住的结构。',
    marks: [], live: null, radius: 0, atrv: 0,
  };
}

export function holdPush(found, mark, radius) {
  if (!mark) return;
  for (let i = 0; i < found.length; i++) {
    const cur = found[i];
    if (cur.i === mark.i && cur.dir === mark.dir) {
      if (mark.score > cur.score) found[i] = mark;
      return;
    }
    if (cur.dir === mark.dir && Math.abs(cur.price - mark.price) <= radius && Math.abs(cur.i - mark.i) <= 2) {
      if (mark.score > cur.score) found[i] = mark;
      return;
    }
  }
  found.push(mark);
}

export function computeHold(klines) {
  const empty = holdEmpty();
  if (!klines || klines.length < 16) return empty;
  const n = klines.length;
  const end = pbClosedEnd(klines);
  if (end < 12) return empty;
  const last = klines[n - 1];
  const atrv = atr(klines, 14) || atrFallback(last.c);
  const radius = Math.max(atrv * 0.38, last.c * 0.00022);
  const thresh = Math.max(atrv * 0.22, last.c * 0.00015);
  const closes = klines.map((x) => x.c);
  const e9 = ema(closes, 9);
  const sr = getSr(klines);
  const levels = (sr && sr.levels) ? sr.levels.slice() : [];
  const recency = 24;
  const found = [];

  function tryLevel(i, level, dir, src, srcScore, closed) {
    if (level == null || !Number.isFinite(level)) return;
    const bar = klines[i];
    if (!fibHoldBar(bar, level, dir, radius, thresh)) return;
    const depth = dir > 0 ? (level - bar.l) : (bar.h - level);
    if (depth < 0) return;
    if ((src === 'ema' || src === 'sr') && depth < thresh * 0.45) return;
    if (src === 'ema' && i > 0) {
      const prevC = klines[i - 1].c;
      if (dir > 0 && prevC > level + thresh) return;
      if (dir < 0 && prevC < level - thresh) return;
    }
    const age = end - Math.min(i, end);
    const score = srcScore + (closed ? 2.2 : 0.6) + (1 - Math.min(1, age / recency)) + Math.min(1.2, depth / Math.max(atrv, 1e-6));
    const status = closed ? 'trigger' : 'watch';
    const lab = dir > 0
      ? (status === 'trigger' ? '企稳' : '企稳?')
      : (status === 'trigger' ? '受阻' : '受阻?');
    const srcName = src === 'ema' ? 'EMA9' : (src === 'sr' ? '支压' : '前低前高');
    const why = (dir > 0 ? '下影线探到' : '上影线探到') + srcName + ' ' + px(level) +
      (status === 'trigger'
        ? (' 后收盘守在这一侧。只描述结构，不是下单指令。')
        : ('，还要等这根收盘确认。'));
    holdPush(found, {
      i: i, dir: dir, price: level, src: src, status: status, lab: lab, why: why,
      score: score, tap: dir > 0 ? bar.l : bar.h, close: bar.c,
    }, radius);
  }

  function scanBar(i, closed) {
    levels.forEach((lv) => {
      if (!lv || lv.price == null) return;
      if (lv.breakI != null && lv.breakI < i) return;
      const dir = klines[i].c >= lv.price ? 1 : -1;
      const srcScore = 2.4 + Math.min(1.2, (lv.touches || 0) * 0.25);
      tryLevel(i, lv.price, dir, 'sr', srcScore, closed);
    });
    const ma = e9[i];
    if (ma != null) {
      const dir = klines[i].c >= ma ? 1 : -1;
      tryLevel(i, ma, dir, 'ema', 1.35, closed);
    }
  }
  const scanFrom = Math.max(8, end - recency);
  for (let i = scanFrom; i <= end; i++) scanBar(i, true);
  if (n - 1 > end) scanBar(n - 1, false);

  if (!found.length) return empty;
  found.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.i - a.i;
  });
  const marks = [];
  found.forEach((mk) => {
    if (marks.length >= 3) return;
    const clash = marks.some((x) => x.i === mk.i || (x.dir === mk.dir && Math.abs(x.price - mk.price) <= radius));
    if (clash) return;
    marks.push(mk);
  });
  marks.sort((a, b) => a.i - b.i);
  const live = marks.filter((m) => m.status === 'watch').slice().sort((a, b) => b.score - a.score)[0] || null;
  const confirmed = marks.filter((m) => m.status === 'trigger').slice().sort((a, b) => b.score - a.score);
  const top = confirmed.length ? confirmed[0] : live;
  let vote = 0;
  let why = empty.why;
  let status = 'none';
  let dir = 0;
  if (top && top.status === 'trigger' && end - top.i <= 8) {
    vote = top.dir;
    why = top.why;
    status = 'trigger';
    dir = top.dir;
  } else if (live) {
    why = live.why;
    status = 'watch';
    dir = live.dir;
  } else if (top) {
    why = top.why + '这段已经过去，不再作为新的方向票。';
    status = 'done';
    dir = top.dir;
  }
  const title = top ? top.lab : empty.title;
  return {
    ok: true, vote: vote, dir: dir, status: status,
    label: title, title: title, why: why,
    marks: marks, live: live, radius: radius, atrv: atrv,
  };
}

export function getHold(klines) {
  const last = klines && klines[klines.length - 1];
  const t = state.ticker;
  const key = [klines && klines.length, last && last.t, last && last.c, last && last.h, last && last.l, state.tf, t && t.prev, t && t.open].join(':');
  if (state._holdKey === key && state._hold) return state._hold;
  const pack = computeHold(klines);
  state._holdKey = key;
  state._hold = pack;
  return pack;
}
