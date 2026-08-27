import { pbClosedEnd } from '../core/bars.js';
import { atrFallback, n, px } from '../core/format.js';
import { atr } from '../core/math.js';
import { srCluster, srCollectPivots, srMedian, srPivotK } from './sr.js';
import { state } from '../state.js';

export function trapLook(tf) {
  if (tf === '10s') {
    return { minAge: 6, maxAge: 52, recency: 16, minSweepAtr: 0.16, maxSweepAtr: 1.05, reclaimAtr: 0.12, clusterAtr: 0.32, pinWick: 1.35, multiMax: 5 };
  }
  if (tf === '1m') {
    return { minAge: 4, maxAge: 40, recency: 12, minSweepAtr: 0.14, maxSweepAtr: 0.95, reclaimAtr: 0.12, clusterAtr: 0.35, pinWick: 1.3, multiMax: 4 };
  }
  if (tf === '5m' || tf === '15m') {
    return { minAge: 3, maxAge: 32, recency: 10, minSweepAtr: 0.13, maxSweepAtr: 0.9, reclaimAtr: 0.12, clusterAtr: 0.38, pinWick: 1.25, multiMax: 4 };
  }
  return { minAge: 3, maxAge: 24, recency: 8, minSweepAtr: 0.12, maxSweepAtr: 0.85, reclaimAtr: 0.1, clusterAtr: 0.4, pinWick: 1.2, multiMax: 3 };
}

export function trapEmpty() {
  return {
    kind: 'trap', dir: 0, status: 'none', vote: 0,
    label: '诱空诱多未现', title: '诱空诱多未现',
    why: '近端没有扫过前高或前低后收回的结构。',
    points: [], sweepI: -1, recI: -1, srcI: -1, firstI: -1,
    level: null, sweepPx: null, target: null, score: 0,
    equal: false, radius: 0, hide: false,
  };
}

export function trapRank(p) {
  if (!p || p.status === 'none') return 0;
  if (p.status === 'trigger') return 4;
  if (p.status === 'watch') return 3;
  if (p.status === 'done') return 1;
  return 0;
}

export function computeTrap(klines) {
  const empty = trapEmpty();
  if (!klines || klines.length < 20) return empty;
  const cfg = trapLook(state.tf);
  const n = klines.length;
  const end = pbClosedEnd(klines);
  if (end < 16) return empty;
  const last = klines[n - 1];
  const atrv = atr(klines, 14) || atrFallback(last.c);
  const radius = Math.max(atrv * cfg.clusterAtr, last.c * 0.00022);
  const minSweep = Math.max(atrv * cfg.minSweepAtr, last.c * 0.00012);
  const maxSweep = Math.max(atrv * cfg.maxSweepAtr, minSweep * 2);
  const recThresh = Math.max(atrv * cfg.reclaimAtr, last.c * 0.0001);
  const k = srPivotK(state.tf);
  const pivots = srCollectPivots(klines, k);
  const srcPivots = pivots.filter((p) => end - p.i >= cfg.minAge);
  if (srcPivots.length < 2) return empty;
  const clusters = srCluster(srcPivots, radius);
  const levels = [];
  clusters.forEach((cl) => {
    const lows = (cl.pivots || []).filter((p) => p.kind === 'l');
    const highs = (cl.pivots || []).filter((p) => p.kind === 'h');
    if (lows.length) {
      const src = lows.reduce((a, b) => (a.i > b.i ? a : b));
      levels.push({
        dir: 1,
        price: srMedian(lows.map((p) => p.price)),
        srcI: src.i,
        firstI: Math.min.apply(null, lows.map((p) => p.i)),
        touches: lows.length,
        equal: lows.length >= 2,
      });
    }
    if (highs.length) {
      const src = highs.reduce((a, b) => (a.i > b.i ? a : b));
      levels.push({
        dir: -1,
        price: srMedian(highs.map((p) => p.price)),
        srcI: src.i,
        firstI: Math.min.apply(null, highs.map((p) => p.i)),
        touches: highs.length,
        equal: highs.length >= 2,
      });
    }
  });

  const found = [];
  levels.forEach((lv) => {
    if (end - lv.srcI > cfg.maxAge) return;
    const scanFrom = Math.max(lv.srcI + 1, end - cfg.recency);
    let sweepI = -1;
    let sweepPx = null;
    for (let i = scanFrom; i < n; i++) {
      const bar = klines[i];
      const beyond = lv.dir > 0 ? (lv.price - bar.l) : (bar.h - lv.price);
      if (beyond < minSweep || beyond > maxSweep) continue;
      let priorBreak = false;
      for (let j = lv.srcI + 1; j < i; j++) {
        const br = lv.dir > 0
          ? klines[j].c < lv.price - recThresh
          : klines[j].c > lv.price + recThresh;
        if (br) { priorBreak = true; break; }
      }
      if (priorBreak) continue;
      sweepI = i;
      sweepPx = lv.dir > 0 ? bar.l : bar.h;
    }
    if (sweepI < 0) return;

    const sweepBar = klines[sweepI];
    const bodyRaw = Math.abs(sweepBar.c - sweepBar.o);
    const body = bodyRaw || 1e-9;
    const wick = lv.dir > 0
      ? (Math.min(sweepBar.o, sweepBar.c) - sweepBar.l)
      : (sweepBar.h - Math.max(sweepBar.o, sweepBar.c));
    // 十字星实体过小（<0.08·ATR）时 pin 不成立，避免 ||1e-9 使任意影线过关
    const pin = bodyRaw >= atrv * 0.08 && wick >= body * cfg.pinWick;
    const sameBack = lv.dir > 0 ? sweepBar.c >= lv.price : sweepBar.c <= lv.price;
    const liveSweep = sweepI > end;
    if (!lv.equal && !pin && !sameBack && !liveSweep) return;
    if (!lv.equal && !pin && liveSweep && wick < body * 0.9) return;

    let recI = -1;
    let failI = -1;
    const recEnd = liveSweep ? sweepI - 1 : end;
    for (let i = sweepI; i <= recEnd; i++) {
      const b = klines[i];
      if (i > sweepI) {
        const broke = lv.dir > 0
          ? b.c < lv.price - recThresh
          : b.c > lv.price + recThresh;
        if (broke) { failI = i; break; }
      }
      const rec = i === sweepI
        ? (lv.dir > 0 ? b.c >= lv.price : b.c <= lv.price)
        : (lv.dir > 0 ? b.c > lv.price + recThresh : b.c < lv.price - recThresh);
      if (rec) recI = i;
    }
    if (failI >= 0 && recI >= 0 && failI < recI) recI = -1;

    const away = lv.dir > 0 ? (last.c - lv.price) : (lv.price - last.c);
    let status = 'watch';
    if (liveSweep) status = 'watch';
    else if (failI >= 0 && recI < 0) status = 'fail';
    else if (recI >= 0 && away >= atrv * 0.85) status = 'done';
    else if (recI >= 0 && (lv.equal || pin || recI > sweepI)) status = 'trigger';
    else if (recI < 0 && !liveSweep && end - sweepI > cfg.multiMax) return;
    if (status === 'fail' && end - sweepI > 3) return;
    if (status === 'done' && recI >= 0 && end - recI > 6) return;
    if (status === 'watch' && !lv.equal && !pin && !liveSweep) return;

    const name = lv.dir > 0 ? '诱空' : '诱多';
    const side = lv.dir > 0 ? '前低' : '前高';
    const eqTxt = lv.equal ? ('（等' + (lv.dir > 0 ? '低' : '高') + ' ' + lv.touches + ' 次）') : '';
    const depth = lv.dir > 0 ? (lv.price - sweepPx) : (sweepPx - lv.price);
    let title = name + ' 等待收回';
    if (status === 'trigger') title = name + ' 已收回';
    if (status === 'done') title = name + ' 已走完';
    if (status === 'fail') title = name + ' 失效';
    if (liveSweep) title = name + ' 扫位中';
    let vote = 0;
    if (status === 'trigger') vote = lv.dir;
    let why = name + '：扫过' + side + ' ' + px(lv.price) + eqTxt +
      ' 约 ' + px(depth) + '（' + (depth / Math.max(atrv, 1e-6)).toFixed(1) + ' 倍 ATR）。';
    if (status === 'trigger') {
      why += recI === sweepI
        ? '同一根收盘已经回到该位这一侧。只描述结构，不是下单指令。'
        : '随后收盘重新' + (lv.dir > 0 ? '站上' : '跌破') + '该位。只描述结构，不是下单指令。';
    } else if (status === 'watch') {
      why += liveSweep
        ? '正在扫位，还要等这根收盘确认收回。'
        : ('已经扫过，还要等收盘' + (lv.dir > 0 ? '站上' : '跌破') + '该位才算收回。');
    } else if (status === 'done') {
      why += '收回后已经离开扫位较远，这段不宜再当新信号。';
    } else {
      why += '扫位后收盘没有收回，更像真突破。';
    }

    found.push({
      kind: 'trap', dir: lv.dir, status: status, vote: vote,
      score: (depth / Math.max(atrv, 1e-6)) * (lv.equal ? 1.28 : 1) * (pin ? 1.12 : 1) *
        (1 - Math.min(1, (end - sweepI) / Math.max(cfg.recency, 1)) * 0.4) *
        (status === 'trigger' ? 1.2 : 1),
      srcI: lv.srcI, firstI: lv.firstI, sweepI: sweepI, recI: recI, failI: failI,
      level: lv.price, sweepPx: sweepPx, atrv: atrv, radius: radius,
      equal: lv.equal, touches: lv.touches, pin: pin,
      title: title, label: title, why: why,
      target: null,
      points: [
        { i: lv.srcI, price: lv.price, lab: '位' },
        { i: sweepI, price: sweepPx, lab: name },
        recI >= 0
          ? { i: recI, price: klines[recI].c, lab: '收回' }
          : { i: n - 1, price: last.c, lab: '等待' },
      ],
    });
  });

  if (!found.length) return empty;
  found.sort((a, b) => {
    const ra = trapRank(a), rb = trapRank(b);
    if (rb !== ra) return rb - ra;
    if (b.sweepI !== a.sweepI) return b.sweepI - a.sweepI;
    return b.score - a.score;
  });
  const top = found[0];
  const rival = found.find((p) => p.dir !== top.dir && trapRank(p) >= 3);
  if (rival && trapRank(rival) >= trapRank(top) && top.vote && rival.vote) {
    return Object.assign({}, top, {
      vote: 0,
      why: top.why + '。同时出现相反方向的诱空/诱多，方向票先不计。',
    });
  }
  return top;
}

export function getTrap(klines) {
  const last = klines && klines[klines.length - 1];
  const key = [klines && klines.length, last && last.t, last && last.c, last && last.h, last && last.l, state.tf].join(':');
  if (state._trapKey === key && state._trap) return state._trap;
  const pack = computeTrap(klines);
  state._trapKey = key;
  state._trap = pack;
  return pack;
}
