import { pbClosedEnd } from '../core/bars.js';
import { atrFallback, n, px } from '../core/format.js';
import { atr, swings } from '../core/math.js';
import { state } from '../state.js';

export function smcSigLook(tf) {
  if (tf === '10s') return { recency: 18, maxWait: 52, doneAtr: 0.85 };
  if (tf === '1m') return { recency: 12, maxWait: 36, doneAtr: 0.85 };
  if (tf === '5m' || tf === '15m') return { recency: 10, maxWait: 28, doneAtr: 0.8 };
  return { recency: 8, maxWait: 20, doneAtr: 0.75 };
}

export function smcPoiTap(bar, poi) {
  return bar.l <= poi.top && bar.h >= poi.bot;
}

export function smcPoiHold(dir, bar, poi) {
  const span = Math.max(poi.top - poi.bot, 1e-9);
  if (dir > 0) return bar.c >= poi.bot && bar.c >= poi.bot + span * 0.2;
  return bar.c <= poi.top && bar.c <= poi.top - span * 0.2;
}

export function smcPoiThrough(dir, bar, poi) {
  if (dir > 0) return bar.c < poi.bot;
  return bar.c > poi.top;
}

export function smcEventPois(ev, fvgsAll) {
  if (ev.ob) {
    return [{ kind: 'ob', i: ev.ob.i, top: ev.ob.top, bot: ev.ob.bot }];
  }
  const pois = [];
  (fvgsAll || []).forEach((g) => {
    if (g.dir !== ev.dir) return;
    if (g.i1 < ev.from || g.i1 > ev.i + 1) return;
    pois.push({ kind: 'fvg', i: g.i0, top: g.top, bot: g.bot });
  });
  return pois;
}

export function smcSignalFromEvent(klines, ev, pois, end, atrv, cfg) {
  if (!pois.length) return null;
  const n = klines.length;
  const last = klines[n - 1];
  if (ev.i >= end) return null;
  if (end - ev.i > cfg.maxWait) return null;
  const start = ev.i + 1;
  if (start >= n) return null;

  let tapI = -1;
  let tapPoi = null;
  let holdI = -1;
  let failI = -1;
  let liveTap = false;

  for (let i = start; i < n; i++) {
    const bar = klines[i];
    const closed = i <= end;
    if (tapI < 0) {
      let hit = null;
      for (let p = 0; p < pois.length; p++) {
        if (!smcPoiTap(bar, pois[p])) continue;
        if (!hit || pois[p].kind === 'ob') hit = pois[p];
      }
      if (hit) {
        tapI = i;
        tapPoi = hit;
        if (!closed) liveTap = true;
      }
    }
    if (tapI < 0) continue;
    if (smcPoiThrough(ev.dir, bar, tapPoi)) {
      if (holdI < 0) {
        failI = i;
        break;
      }
      if (closed) {
        failI = i;
        break;
      }
    }
    if (holdI < 0 && smcPoiHold(ev.dir, bar, tapPoi)) {
      if (closed) holdI = i;
      else liveTap = true;
    }
  }

  if (tapI < 0) return null;
  if (failI >= 0 && holdI < 0) return null;

  const poi = tapPoi;
  const away = ev.dir > 0 ? (last.c - poi.top) : (poi.bot - last.c);
  let status = 'watch';
  if (failI >= 0 && holdI >= 0) status = 'fail';
  else if (liveTap && holdI < 0) status = 'watch';
  else if (holdI >= 0 && away >= atrv * cfg.doneAtr) status = 'done';
  else if (holdI >= 0) status = 'trigger';
  else status = 'watch';

  if (status === 'fail' && end - failI > 3) return null;
  if (status === 'done' && end - holdI > cfg.recency) return null;
  if (status === 'watch' && !liveTap && end - tapI > cfg.recency && holdI < 0) return null;

  const sigI = holdI >= 0 ? holdI : tapI;
  if (n - 1 - sigI > cfg.maxWait) return null;

  const side = ev.dir > 0 ? '做多' : '做空';
  const poiName = poi.kind === 'ob' ? '订单区块' : '缺口';
  const evName = ev.kind === 'CHoCH' ? '转势' : '延续突破';
  let title = 'SMC ' + side + '等待';
  if (status === 'trigger') title = 'SMC ' + side + ' · 回踩' + poiName;
  else if (status === 'watch') title = liveTap ? ('SMC ' + side + '回踩中') : ('SMC ' + side + '等待收盘');
  else if (status === 'done') title = 'SMC ' + side + '已走完';
  else if (status === 'fail') title = 'SMC ' + side + '失效';

  let vote = 0;
  if (status === 'trigger') vote = ev.dir;

  let why = 'SMC ' + side + '：' + evName + '后回踩' + poiName +
    ' ' + px(poi.bot) + '–' + px(poi.top) + '。';
  if (status === 'trigger') {
    why += sigI === tapI
      ? '同一根已经踩进该区并收在区内。只描述结构，不是下单指令。'
      : '踩进该区后收盘守住。只描述结构，不是下单指令。';
  } else if (status === 'watch') {
    why += liveTap
      ? '正在回踩该区，还要等这根收盘守住才算信号。'
      : '已经踩到该区，还要等收盘守住才算信号。';
  } else if (status === 'done') {
    why += '信号后已经离开该区较远，这段不宜再当新信号。';
  } else {
    why += '回踩后收盘穿过该区，信号失效。';
  }

  return {
    dir: ev.dir,
    status: status,
    vote: vote,
    i: sigI,
    tapI: tapI,
    holdI: holdI,
    failI: failI,
    eventI: ev.i,
    eventKind: ev.kind,
    poiKind: poi.kind,
    poi: poi,
    title: title,
    label: status === 'watch' ? (side + '?') : side,
    why: why,
    live: liveTap,
  };
}

export function smcBuildSignals(klines, events, fvgsAll) {
  const out = [];
  if (!klines || !events || !events.length) return out;
  const end = pbClosedEnd(klines);
  if (end < 6) return out;
  const last = klines[klines.length - 1];
  const atrv = atr(klines, 14) || atrFallback(last.c);
  const cfg = smcSigLook(state.tf);
  const byBar = {};
  for (let e = 0; e < events.length; e++) {
    const ev = events[e];
    const pois = smcEventPois(ev, fvgsAll);
    const sig = smcSignalFromEvent(klines, ev, pois, end, atrv, cfg);
    if (!sig) continue;
    const prev = byBar[sig.i];
    if (!prev) {
      byBar[sig.i] = sig;
      continue;
    }
    const better = (sig.eventKind === 'CHoCH' && prev.eventKind !== 'CHoCH')
      || (sig.eventKind === prev.eventKind && sig.poiKind === 'ob' && prev.poiKind !== 'ob');
    if (better) byBar[sig.i] = sig;
  }
  Object.keys(byBar).forEach((k) => out.push(byBar[k]));
  out.sort((a, b) => a.i - b.i);
  return out;
}

export function smcLiveOf(signals, n, recency) {
  if (!signals || !signals.length) return null;
  let best = null;
  let bestR = -1;
  signals.forEach((s) => {
    const age = n - 1 - s.i;
    if (s.status === 'fail' || s.status === 'done') return;
    if (s.status !== 'watch' && age > recency) return;
    let r = s.status === 'trigger' ? 4 : 3;
    r += s.eventKind === 'CHoCH' ? 0.4 : 0;
    r += s.poiKind === 'ob' ? 0.2 : 0;
    r += Math.max(0, 1 - age / Math.max(recency, 1));
    if (r > bestR) {
      bestR = r;
      best = s;
    }
  });
  return best;
}

export function smcPivotK(tf) {
  if (tf === '10s') return 3;
  if (tf === '1m' || tf === '5m') return 3;
  return 2;
}

export function computeSmc(klines) {
  const empty = { events: [], obs: [], fvgs: [], signals: [], live: null, trend: 0, label: '' };
  if (!klines || klines.length < 8) return empty;
  const lastPx = klines[klines.length - 1].c;
  const atrv = atr(klines, 14) || atrFallback(lastPx);
  const SMC_BREAK_ATR = 0.28;
  const k = smcPivotK(state.tf);
  const swings = [];
  for (let i = k; i < klines.length - k; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= k; j++) {
      if (!(klines[i].h > klines[i - j].h && klines[i].h >= klines[i + j].h)) isH = false;
      if (!(klines[i].l < klines[i - j].l && klines[i].l <= klines[i + j].l)) isL = false;
    }
    if (isH) swings.push({ i: i, kind: 'h', price: klines[i].h });
    if (isL) swings.push({ i: i, kind: 'l', price: klines[i].l });
  }

  const events = [];
  let trend = 0;
  let lastH = null;
  let lastL = null;
  const used = { h: -1, l: -1 };
  let s = 0;
  for (let i = 0; i < klines.length; i++) {
    while (s < swings.length && swings[s].i <= i) {
      if (swings[s].kind === 'h') lastH = swings[s];
      else lastL = swings[s];
      s += 1;
    }
    const c = klines[i].c;
    if (lastH && i > lastH.i && lastH.i !== used.h && c >= lastH.price + atrv * SMC_BREAK_ATR) {
      const kind = trend === -1 ? 'CHoCH' : 'BOS';
      let obI = -1;
      for (let j = i - 1; j >= lastH.i && j >= 0; j--) {
        if (klines[j].c < klines[j].o) { obI = j; break; }
      }
      const ev = { kind: kind, dir: 1, i: i, from: lastH.i, price: lastH.price, ob: null };
      if (obI >= 0) {
        const b = klines[obI];
        const body = Math.abs(b.o - b.c);
        if (body >= atrv * 0.22) {
          ev.ob = { dir: 1, i: obI, top: Math.max(b.o, b.c), bot: Math.min(b.o, b.c) };
        }
      }
      events.push(ev);
      trend = 1;
      used.h = lastH.i;
    } else if (lastL && i > lastL.i && lastL.i !== used.l && c <= lastL.price - atrv * SMC_BREAK_ATR) {
      const kind = trend === 1 ? 'CHoCH' : 'BOS';
      let obI = -1;
      for (let j = i - 1; j >= lastL.i && j >= 0; j--) {
        if (klines[j].c > klines[j].o) { obI = j; break; }
      }
      const ev = { kind: kind, dir: -1, i: i, from: lastL.i, price: lastL.price, ob: null };
      if (obI >= 0) {
        const b = klines[obI];
        const body = Math.abs(b.o - b.c);
        if (body >= atrv * 0.22) {
          ev.ob = { dir: -1, i: obI, top: Math.max(b.o, b.c), bot: Math.min(b.o, b.c) };
        }
      }
      events.push(ev);
      trend = -1;
      used.l = lastL.i;
    }
  }

  const obs = [];
  events.forEach((ev) => {
    if (!ev.ob) return;
    const ob = ev.ob;
    let mit = null;
    // 从突破 K 之后开始扫；回补需穿透订单块中位，避免下一根开盘贴着 bot/top 就立刻判回补
    const start = Math.max(ob.i + 1, (ev.i != null ? ev.i : ob.i) + 1);
    const mid = (ob.top + ob.bot) / 2;
    for (let i = start; i < klines.length; i++) {
      if (ob.dir > 0 && klines[i].l <= mid) { mit = i; break; }
      if (ob.dir < 0 && klines[i].h >= mid) { mit = i; break; }
    }
    ob.mit = mit;
    ob.end = mit == null ? klines.length - 1 : mit;
    if (mit == null) obs.push(ob);
  });

  const fvgsAll = [];
  const minGap = Math.max(atrv * 0.18, (klines[klines.length - 1].c || 1) * 0.00008);
  for (let i = 2; i < klines.length; i++) {
    const a = klines[i - 2];
    const c = klines[i];
    let gap = null;
    if (a.h < c.l) gap = { dir: 1, i0: i - 2, i1: i, top: c.l, bot: a.h };
    else if (a.l > c.h) gap = { dir: -1, i0: i - 2, i1: i, top: a.l, bot: c.h };
    if (!gap || gap.top - gap.bot < minGap) continue;
    let mit = null;
    for (let j = i + 1; j < klines.length; j++) {
      if (gap.dir > 0 && klines[j].l <= gap.bot) { mit = j; break; }
      if (gap.dir < 0 && klines[j].h >= gap.top) { mit = j; break; }
    }
    gap.mit = mit;
    gap.end = mit == null ? klines.length - 1 : mit;
    fvgsAll.push(gap);
  }
  const fvgs = fvgsAll.filter((g) => g.mit == null).slice(-8);

  const cfg = smcSigLook(state.tf);
  const signals = smcBuildSignals(klines, events, fvgsAll);
  const live = smcLiveOf(signals, klines.length, cfg.recency);

  const last = events[events.length - 1];
  let label = '';
  if (live) label = live.title;
  else if (last) label = last.kind + ' ' + (last.dir > 0 ? '偏多' : '偏空');
  else if (trend > 0) label = '结构偏多';
  else if (trend < 0) label = '结构偏空';
  else label = '结构未定';

  return {
    events: events.slice(-8),
    obs: obs.slice(-5),
    fvgs: fvgs,
    signals: signals.slice(-8),
    live: live,
    trend: trend,
    label: label,
  };
}

export function getSmc(klines) {
  const last = klines && klines[klines.length - 1];
  const key = [
    klines && klines.length,
    last && last.t, last && last.o, last && last.h, last && last.l, last && last.c,
    state.tf,
  ].join(':');
  if (state._smcKey === key && state._smc) return state._smc;
  const pack = computeSmc(klines);
  state._smcKey = key;
  state._smc = pack;
  return pack;
}
