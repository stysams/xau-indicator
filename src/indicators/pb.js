import { pbClosedEnd } from '../core/bars.js';
import { atrFallback, n, px } from '../core/format.js';
import { atr, bollCore, ema, rsiSeries } from '../core/math.js';
import { analyzeBoll } from './boll.js';
import { getTrap } from './trap.js';
import { factorOn } from '../judge/factors.js';
import { state } from '../state.js';

export function pbLook(tf) {
  if (tf === '10s') return { minSpan: 8, maxSpan: 40, minAtr: 1.7, hold: 0.46, recency: 16, rsiLo: 36, rsiHi: 64 };
  if (tf === '1m') return { minSpan: 5, maxSpan: 24, minAtr: 1.5, hold: 0.4, recency: 12, rsiLo: 34, rsiHi: 66 };
  if (tf === '5m' || tf === '15m') return { minSpan: 4, maxSpan: 18, minAtr: 1.4, hold: 0.38, recency: 10, rsiLo: 32, rsiHi: 68 };
  return { minSpan: 3, maxSpan: 14, minAtr: 1.3, hold: 0.36, recency: 8, rsiLo: 30, rsiHi: 70 };
}

export function pbLocalExtrema(klines, start, end, dir, k) {
  k = k || 2;
  const out = [];
  for (let i = Math.max(k, start); i <= end; i++) {
    let ok = true;
    for (let j = 1; j <= k; j++) {
      const L = i - j;
      const R = i + j;
      if (L < 0) { ok = false; break; }
      if (dir > 0) {
        if (klines[i].l > klines[L].l) { ok = false; break; }
        if (R <= end && klines[i].l > klines[R].l) { ok = false; break; }
      } else {
        if (klines[i].h < klines[L].h) { ok = false; break; }
        if (R <= end && klines[i].h < klines[R].h) { ok = false; break; }
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

export function pbArg(klines, from, to, dir, useLow) {
  let i = from;
  let p = useLow ? Infinity : -Infinity;
  for (let k = from; k <= to; k++) {
    if (useLow) {
      if (klines[k].l <= p) { p = klines[k].l; i = k; }
    } else if (klines[k].h >= p) {
      p = klines[k].h;
      i = k;
    }
  }
  return i;
}

export function pbNearMA(price, i, e9, e21, mid, hold) {
  const xs = [e9[i], e21[i], mid && mid[i]];
  for (let k = 0; k < xs.length; k++) {
    if (xs[k] != null && Math.abs(price - xs[k]) <= hold) return true;
  }
  return false;
}

export function pbRank(p) {
  if (!p || p.status === 'none') return 0;
  if (p.status === 'trigger') return 4;
  if (p.status === 'watch') return 3;
  if (p.status === 'done') return 1;
  return 0;
}

export function pbPick(found, empty) {
  if (!found.length) return empty;
  found.sort((a, b) => {
    const ra = pbRank(a), rb = pbRank(b);
    if (rb !== ra) return rb - ra;
    if (b.extI !== a.extI) return b.extI - a.extI;
    return b.score - a.score;
  });
  return found[0];
}

export function pbEmpty(kind) {
  if (kind === 'bounce') {
    return {
      kind: 'bounce', dir: 0, status: 'none', vote: 0,
      label: '超跌反弹未现', title: '超跌反弹未现',
      why: '近端没有足够深的急跌，或还没有收回迹象。',
      points: [], fromI: -1, extI: -1, recI: -1, target: null, score: 0,
    };
  }
  return {
    kind: 'pull', dir: 0, status: 'none', vote: 0,
    label: '拉升回踩未现', title: '拉升回踩未现',
    why: '近端没有足够的拉升后回踩，或回踩还没踩住均线。',
    points: [], fromI: -1, extI: -1, recI: -1, pbI: -1, target: null, score: 0,
  };
}

export function computeBounce(klines) {
  const empty = pbEmpty('bounce');
  if (!klines || klines.length < 20) return empty;
  const cfg = pbLook(state.tf);
  const n = klines.length;
  const end = pbClosedEnd(klines);
  if (end < 16) return empty;
  const last = klines[n - 1];
  const atrv = atr(klines, 14) || atrFallback(last.c);
  const closes = klines.map((x) => x.c);
  const e9 = ema(closes, 9);
  const rs = rsiSeries(closes, state.rsiN || 14);
  const boll = analyzeBoll(klines);
  const startScan = Math.max(cfg.minSpan + 2, end - cfg.recency);
  const found = [];

  [1, -1].forEach((dir) => {
    const cands = pbLocalExtrema(klines, startScan, end, dir, 2);
    const live = pbArg(klines, Math.max(0, end - 3), end, dir, dir > 0);
    if (cands.indexOf(live) < 0) cands.push(live);
    cands.forEach((extI) => {
      const fromB = extI - cfg.minSpan;
      const fromA = Math.max(0, extI - cfg.maxSpan);
      if (fromB <= fromA) return;
      const fromI = pbArg(klines, fromA, fromB, dir, dir < 0);
      const extPx = dir > 0 ? klines[extI].l : klines[extI].h;
      const fromPx = dir > 0 ? klines[fromI].h : klines[fromI].l;
      const impulse = dir * (fromPx - extPx);
      if (!(impulse >= cfg.minAtr * atrv)) return;
      let wH = -Infinity, wL = Infinity;
      for (let i = fromI; i <= extI; i++) {
        wH = Math.max(wH, klines[i].h);
        wL = Math.min(wL, klines[i].l);
      }
      if (impulse < 0.7 * (wH - wL || impulse)) return;
      const rExt = rs[extI];
      const pbExt = boll.ok && boll.pb ? boll.pb[extI] : null;
      const bar = klines[extI];
      const bodyRaw = Math.abs(bar.c - bar.o);
      const body = bodyRaw || 1e-9;
      const wick = dir > 0 ? (Math.min(bar.o, bar.c) - bar.l) : (bar.h - Math.max(bar.o, bar.c));
      const rsiExt = (dir > 0 && rExt != null && rExt <= cfg.rsiLo)
        || (dir < 0 && rExt != null && rExt >= cfg.rsiHi);
      const bandExt = (dir > 0 && pbExt != null && pbExt <= 0.1 && rExt != null && rExt <= cfg.rsiLo + 4)
        || (dir < 0 && pbExt != null && pbExt >= 0.9 && rExt != null && rExt >= cfg.rsiHi - 4);
      const wickExt = bodyRaw >= atrv * 0.08 && wick > body * 1.8 && rExt != null && (
        (dir > 0 && rExt <= cfg.rsiLo + 4) || (dir < 0 && rExt >= cfg.rsiHi - 4)
      );
      const extreme = rsiExt || bandExt || wickExt;
      if (!extreme) return;

      let recI = -1;
      let failI = -1;
      for (let i = extI + 1; i <= end; i++) {
        const b = klines[i];
        const broke = dir > 0 ? b.l < extPx - atrv * 0.12 : b.h > extPx + atrv * 0.12;
        if (broke) { failI = i; break; }
        const a = e9[i];
        const rec = a != null && (
          dir > 0
            ? (b.c > a && b.c >= b.o && b.c > extPx + atrv * 0.2)
            : (b.c < a && b.c <= b.o && b.c < extPx - atrv * 0.2)
        );
        if (rec) recI = i;
      }
      const retrace = impulse > 0 ? (dir * (last.c - extPx)) / impulse : 0;
      let status = 'watch';
      if (failI >= 0) status = 'fail';
      else if (recI >= 0 && retrace >= 0.8) status = 'done';
      else if (recI >= 0) status = 'trigger';
      if (status === 'watch' && retrace > 0.35) return;
      if (status === 'fail' && recI < 0 && end - extI > 4) return;

      const age = end - extI;
      const name = dir > 0 ? '超跌反弹' : '超涨回落';
      let title = name + ' 等待收回';
      if (status === 'trigger') title = name + ' 已收回';
      if (status === 'done') title = name + ' 反弹已走完';
      if (status === 'fail') title = name + ' 失效';
      let vote = 0;
      if (status === 'trigger' && retrace >= 0.1 && retrace <= 0.58) vote = dir;
      const rsiTxt = rExt == null ? '--' : rExt.toFixed(1);
      const pct = (retrace * 100).toFixed(0);
      let why = name + '：急' + (dir > 0 ? '跌' : '涨') + '约 ' + px(impulse) +
        '（' + (impulse / atrv).toFixed(1) + ' 倍 ATR），低/高点 RSI ' + rsiTxt + '。';
      if (status === 'trigger') why += '收盘已重新' + (dir > 0 ? '站上' : '跌破') + ' EMA9，从端点收回 ' + pct + '%。只描述结构，不是下单指令。';
      else if (status === 'watch') why += '现价仍在端点附近，还要等收盘' + (dir > 0 ? '站上' : '跌破') + ' EMA9 才算收回。';
      else if (status === 'done') why += '已经收回 ' + pct + '%，这段反弹走得比较充分，不宜再当新信号。';
      else why += '端点被重新打穿，结构失效。';

      found.push({
        kind: 'bounce', dir: dir, status: status, vote: vote,
        score: (impulse / Math.max(atrv, 1e-6)) * (1 - Math.min(1, age / Math.max(cfg.recency, 1)) * 0.45) * (status === 'trigger' ? 1.2 : 1),
        fromI: fromI, extI: extI, recI: recI, failI: failI,
        fromPx: fromPx, extPx: extPx, impulse: impulse, atrv: atrv, retrace: retrace,
        target: dir > 0 ? extPx + impulse * 0.5 : extPx - impulse * 0.5,
        title: title, label: title, why: why,
        points: [
          { i: fromI, price: fromPx, lab: dir > 0 ? '跌起' : '涨起' },
          { i: extI, price: extPx, lab: dir > 0 ? '低点' : '高点' },
          recI >= 0
            ? { i: recI, price: klines[recI].c, lab: '收回' }
            : { i: n - 1, price: last.c, lab: '等待' },
        ],
      });
    });
  });
  return pbPick(found, empty);
}

export function computePull(klines) {
  const empty = pbEmpty('pull');
  if (!klines || klines.length < 20) return empty;
  const cfg = pbLook(state.tf);
  const n = klines.length;
  const end = pbClosedEnd(klines);
  if (end < 16) return empty;
  const last = klines[n - 1];
  const atrv = atr(klines, 14) || atrFallback(last.c);
  const closes = klines.map((x) => x.c);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const rs = rsiSeries(closes, state.rsiN || 14);
  const mid = bollCore(closes, state.bollN || 20).mid;
  const startScan = Math.max(cfg.minSpan + 2, end - cfg.recency);
  const found = [];
  const holdDist = cfg.hold * atrv;

  [1, -1].forEach((dir) => {
    const cands = pbLocalExtrema(klines, startScan, end, -dir, 2);
    const live = pbArg(klines, Math.max(0, end - 3), end, -dir, dir < 0);
    if (cands.indexOf(live) < 0) cands.push(live);
    cands.forEach((extI) => {
      const fromB = extI - cfg.minSpan;
      const fromA = Math.max(0, extI - cfg.maxSpan);
      if (fromB <= fromA) return;
      const fromI = pbArg(klines, fromA, fromB, dir, dir > 0);
      const extPx = dir > 0 ? klines[extI].h : klines[extI].l;
      const fromPx = dir > 0 ? klines[fromI].l : klines[fromI].h;
      const impulse = dir * (extPx - fromPx);
      if (!(impulse >= cfg.minAtr * atrv)) return;
      let wH = -Infinity, wL = Infinity;
      for (let i = fromI; i <= extI; i++) {
        wH = Math.max(wH, klines[i].h);
        wL = Math.min(wL, klines[i].l);
      }
      if (impulse < 0.7 * (wH - wL || impulse)) return;
      const rExt = rs[extI];
      if (dir > 0 && rExt != null && rExt < 54) return;
      if (dir < 0 && rExt != null && rExt > 46) return;
      if (extI >= end) return;

      let pbI = extI;
      let pbPx = dir > 0 ? Infinity : -Infinity;
      for (let i = extI + 1; i < n; i++) {
        if (dir > 0) {
          if (klines[i].l <= pbPx) { pbPx = klines[i].l; pbI = i; }
        } else if (klines[i].h >= pbPx) {
          pbPx = klines[i].h;
          pbI = i;
        }
      }
      if (pbI <= extI) return;
      const retrace = impulse > 0 ? (dir * (extPx - pbPx)) / impulse : 0;
      if (retrace < 0.22) return;
      const broke = dir > 0 ? pbPx < fromPx + atrv * 0.08 : pbPx > fromPx - atrv * 0.08;
      let held = pbNearMA(pbPx, pbI, e9, e21, mid, holdDist);
      if (!held) {
        const ma = e9[pbI] != null ? e9[pbI] : e21[pbI];
        if (ma != null) {
          held = dir > 0
            ? (klines[pbI].l <= ma + holdDist && klines[pbI].c >= ma - holdDist)
            : (klines[pbI].h >= ma - holdDist && klines[pbI].c <= ma + holdDist);
        }
      }
      const rPb = rs[pbI];
      const cooled = rExt == null || rPb == null || (dir > 0 ? rPb < rExt - 2 : rPb > rExt + 2);

      let recI = -1;
      let failI = -1;
      for (let i = pbI + 1; i <= end; i++) {
        const b = klines[i];
        const worse = dir > 0 ? b.l < pbPx - atrv * 0.12 : b.h > pbPx + atrv * 0.12;
        if (worse) { failI = i; break; }
        const a = e9[i];
        const rec = a != null && (
          dir > 0
            ? (b.c > a && b.c >= b.o && b.c > pbPx + atrv * 0.16)
            : (b.c < a && b.c <= b.o && b.c < pbPx - atrv * 0.16)
        );
        if (rec) recI = i;
      }

      let status = 'watch';
      if (broke || failI >= 0) status = 'fail';
      else if (recI >= 0 && ((dir > 0 && last.c > extPx + atrv * 0.15) || (dir < 0 && last.c < extPx - atrv * 0.15))) status = 'done';
      else if (recI >= 0 && held && retrace >= 0.26 && retrace <= 0.72 && cooled) status = 'trigger';
      else if (!held && retrace > 0.72) status = 'fail';
      else if (!held) status = 'watch';
      if (status === 'watch' && retrace > 0.78) status = 'fail';
      if (status === 'fail' && recI < 0 && !broke && retrace < 0.5) return;

      const name = dir > 0 ? '拉升回踩' : '杀跌反抽';
      let title = name + ' 等待确认';
      if (status === 'trigger') title = name + ' 已踩住';
      if (status === 'done') title = name + ' 已再出发';
      if (status === 'fail') title = name + ' 失效';
      let vote = 0;
      if (status === 'trigger' && retrace >= 0.26 && retrace <= 0.68) vote = dir;
      const pct = (retrace * 100).toFixed(0);
      let why = name + '：先' + (dir > 0 ? '拉升' : '杀跌') + '约 ' + px(impulse) +
        '（' + (impulse / atrv).toFixed(1) + ' 倍 ATR），随后回撤 ' + pct + '%。';
      if (status === 'trigger') why += '回踩碰到均线后，收盘重新' + (dir > 0 ? '站上' : '跌破') + ' EMA9。只描述结构，不是下单指令。';
      else if (status === 'watch') why += held
        ? ('价格碰到均线一带，还要等收盘确认' + (dir > 0 ? '站上' : '跌破') + '。')
        : '还在回撤，尚未踩到 EMA9 / EMA21 附近。';
      else if (status === 'done') why += '回踩后已经越过前高/前低，这段走完了。';
      else why += broke ? '回撤打穿了拉升起点，结构失效。' : '回撤过深或没有踩住均线。';

      found.push({
        kind: 'pull', dir: dir, status: status, vote: vote,
        score: (impulse / Math.max(atrv, 1e-6)) * (held ? 1.15 : 0.9) * (status === 'trigger' ? 1.2 : 1),
        fromI: fromI, extI: extI, recI: recI, pbI: pbI, failI: failI,
        fromPx: fromPx, extPx: extPx, pbPx: pbPx, impulse: impulse, atrv: atrv, retrace: retrace,
        target: extPx,
        title: title, label: title, why: why,
        points: [
          { i: fromI, price: fromPx, lab: dir > 0 ? '拉起' : '杀起' },
          { i: extI, price: extPx, lab: dir > 0 ? '高点' : '低点' },
          { i: pbI, price: pbPx, lab: dir > 0 ? '回踩' : '反抽' },
        ],
      });
    });
  });
  return pbPick(found, empty);
}

export function getPb(klines) {
  const last = klines && klines[klines.length - 1];
  const key = [
    klines && klines.length, last && last.t, last && last.c, last && last.h, last && last.l,
    state.tf, state.bollN, state.bollK,
    state.ind.bounce ? 1 : 0, state.ind.pull ? 1 : 0, state.ind.trap ? 1 : 0,
    factorOn('bounce') ? 1 : 0, factorOn('pull') ? 1 : 0, factorOn('trap') ? 1 : 0,
  ].join(':');
  if (state._pbKey === key && state._pb) return state._pb;
  const pack = { bounce: computeBounce(klines), pull: computePull(klines) };
  const b = pack.bounce;
  const p = pack.pull;
  const bothDraw = !!state.ind.bounce && !!state.ind.pull;
  const bothVote = factorOn('bounce') && factorOn('pull');
  if (b.status !== 'none' && p.status !== 'none' && Math.abs(b.extI - p.extI) <= 3) {
    if (p.retrace >= 0.32 && (p.status === 'trigger' || p.status === 'watch')) {
      pack.bounce = Object.assign({}, b, {
        vote: bothVote ? 0 : b.vote,
        hide: bothDraw ? true : !!b.hide,
        why: bothVote ? b.why + '。同一段更接近回踩，反弹方向票不计。' : b.why,
      });
    } else if (b.retrace <= 0.35 && (b.status === 'trigger' || b.status === 'watch')) {
      pack.pull = Object.assign({}, p, {
        vote: bothVote ? 0 : p.vote,
        hide: bothDraw ? true : !!p.hide,
        why: bothVote ? p.why + '。同一段更接近超跌/超涨收回，回踩方向票不计。' : p.why,
      });
    }
  }
  if (bothVote && pack.bounce.vote && pack.pull.vote && pack.bounce.vote !== pack.pull.vote) {
    if ((pack.bounce.score || 0) >= (pack.pull.score || 0)) {
      pack.pull = Object.assign({}, pack.pull, {
        vote: 0,
        why: pack.pull.why + '。与反弹结构方向对打，方向票先不计。',
      });
    } else {
      pack.bounce = Object.assign({}, pack.bounce, {
        vote: 0,
        why: pack.bounce.why + '。与回踩结构方向对打，方向票先不计。',
      });
    }
  }
  const trapDraw = !!state.ind.trap;
  const trapVote = factorOn('trap');
  if (trapDraw || trapVote) {
    const tr = getTrap(klines);
    if (tr && tr.status === 'trigger') {
      const nearB = Math.abs((tr.sweepI || 0) - (pack.bounce.extI || 0)) <= 2;
      const nearP = Math.abs((tr.sweepI || 0) - (pack.pull.pbI || 0)) <= 2
        || Math.abs((tr.sweepI || 0) - (pack.pull.extI || 0)) <= 2;
      if (nearB && pack.bounce.status !== 'none') {
        const steal = trapVote && factorOn('bounce') && pack.bounce.vote === tr.vote;
        pack.bounce = Object.assign({}, pack.bounce, {
          vote: steal ? 0 : pack.bounce.vote,
          hide: trapDraw ? true : !!pack.bounce.hide,
          why: steal ? pack.bounce.why + '。同一段更接近诱空/诱多扫位，反弹方向票不计。' : pack.bounce.why,
        });
      }
      if (nearP && pack.pull.status !== 'none') {
        const steal = trapVote && factorOn('pull') && pack.pull.vote === tr.vote;
        pack.pull = Object.assign({}, pack.pull, {
          vote: steal ? 0 : pack.pull.vote,
          hide: trapDraw ? true : !!pack.pull.hide,
          why: steal ? pack.pull.why + '。同一段更接近诱空/诱多扫位，回踩方向票不计。' : pack.pull.why,
        });
      }
    }
  }
  state._pbKey = key;
  state._pb = pack;
  return pack;
}
