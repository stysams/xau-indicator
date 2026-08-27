import { atrFallback, n, px } from '../core/format.js';
import { atr } from '../core/math.js';
import { state } from '../state.js';

export function hsPivotK(tf) {
  if (tf === '10s') return 5;
  if (tf === '1m' || tf === '5m') return 4;
  return 2;
}

export function hsNeckAt(t1, t2, i) {
  const d = t2.i - t1.i;
  if (!d) return (t1.price + t2.price) / 2;
  return t1.price + (t2.price - t1.price) * (i - t1.i) / d;
}

export function hsPivots(klines, k) {
  const raw = [];
  for (let i = k; i < klines.length - k; i++) {
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
    if (!alt.length) {
      alt.push(p);
      continue;
    }
    const last = alt[alt.length - 1];
    if (p.kind === last.kind) {
      if (p.kind === 'h' && p.price >= last.price) alt[alt.length - 1] = p;
      if (p.kind === 'l' && p.price <= last.price) alt[alt.length - 1] = p;
    } else {
      alt.push(p);
    }
  }
  return alt;
}

export function hsPriorMove(klines, ls, head, kind) {
  const span = Math.max(8, head.i - ls.i);
  const from = Math.max(0, ls.i - span);
  if (kind === 'top') {
    let minL = Infinity;
    for (let i = from; i < ls.i; i++) minL = Math.min(minL, klines[i].l);
    return ls.price - minL;
  }
  let maxH = -Infinity;
  for (let i = from; i < ls.i; i++) maxH = Math.max(maxH, klines[i].h);
  return maxH - ls.price;
}

export function hsScanBreak(klines, t1, t2, rs, head, kind) {
  const end = Math.max(rs.i + 1, klines.length - 1);
  for (let i = rs.i + 1; i < end; i++) {
    const neck = hsNeckAt(t1, t2, i);
    const c = klines[i].c;
    const fail = kind === 'top' ? c > head.price : c < head.price;
    const brk = kind === 'top' ? c < neck : c > neck;
    if (brk) return { breakI: i, failI: null };
    if (fail) return { breakI: null, failI: i };
  }
  return { breakI: null, failI: null };
}

export function hsLiveShoulder(klines, t2, head, kind, atrv) {
  let rsI = -1;
  let rsP = kind === 'top' ? -Infinity : Infinity;
  for (let i = t2.i + 1; i < klines.length; i++) {
    if (kind === 'top') {
      if (klines[i].h > rsP) { rsP = klines[i].h; rsI = i; }
    } else if (klines[i].l < rsP) {
      rsP = klines[i].l;
      rsI = i;
    }
  }
  if (rsI < 0 || rsI - t2.i < 2) return null;
  if (kind === 'top' && rsP >= head.price) return null;
  if (kind === 'bottom' && rsP <= head.price) return null;
  const last = klines[klines.length - 1];
  const pulled = kind === 'top'
    ? (last.c <= rsP - atrv * 0.25 || last.h < rsP - atrv * 0.12)
    : (last.c >= rsP + atrv * 0.25 || last.l > rsP + atrv * 0.12);
  if (!pulled) return null;
  return { i: rsI, kind: kind === 'top' ? 'h' : 'l', price: rsP };
}

export function hsBuild(klines, ls, t1, head, t2, rs, kind, atrv, liveRs) {
  const n = klines.length;
  const lastPx = klines[n - 1].c;
  const lsH = kind === 'top' ? (ls.price - hsNeckAt(t1, t2, ls.i)) : (hsNeckAt(t1, t2, ls.i) - ls.price);
  const rsH = kind === 'top' ? (rs.price - hsNeckAt(t1, t2, rs.i)) : (hsNeckAt(t1, t2, rs.i) - rs.price);
  const hdH = kind === 'top' ? (head.price - hsNeckAt(t1, t2, head.i)) : (hsNeckAt(t1, t2, head.i) - head.price);
  if (!(hdH > 0 && lsH > 0 && rsH > 0)) return null;
  const minH = Math.max(atrv * (state.tf === '10s' ? 1.6 : 1.40), lastPx * 0.00032);
  if (hdH < minH) return null;
  if (hdH < Math.max(lsH, rsH) * 1.35) return null;
  const sym = Math.min(lsH, rsH) / Math.max(lsH, rsH);
  if (sym < 0.70) return null;
  const width = rs.i - ls.i;
  if (width < Math.max(8, hsPivotK(state.tf) * 4)) return null;
  if (head.i - ls.i < 2 || rs.i - head.i < 2) return null;
  const tSym = Math.abs((head.i - ls.i) - (rs.i - head.i)) / width;
  if (tSym > 0.35) return null;
  if (Math.abs(t2.price - t1.price) / hdH > 0.40) return null;
  if (hsPriorMove(klines, ls, head, kind) < hdH * 0.55) return null;

  const ev = hsScanBreak(klines, t1, t2, rs, head, kind);
  let status = 'forming';
  if (ev.failI != null) status = 'failed';
  else if (ev.breakI != null) status = 'confirmed';
  // forming 超过 24 根未破颈线则丢弃，避免陈旧预备压过新确认
  if (status === 'forming' && (n - 1 - rs.i) > 24) return null;

  const height = hdH;
  const neckBreak = ev.breakI != null ? hsNeckAt(t1, t2, ev.breakI) : hsNeckAt(t1, t2, n - 1);
  const target = kind === 'top' ? neckBreak - height : neckBreak + height;
  let targetHit = false;
  if (status === 'confirmed') {
    for (let i = ev.breakI; i < n; i++) {
      if (kind === 'top' && klines[i].l <= target) targetHit = true;
      if (kind === 'bottom' && klines[i].h >= target) targetHit = true;
    }
  }

  const name = kind === 'top' ? '头肩顶' : '头肩底';
  let title = name + ' 等待破颈线';
  if (liveRs && status === 'forming') title = name + ' 右肩形成中';
  if (status === 'confirmed') title = name + (targetHit ? ' 量度已到' : ' 已破颈线');
  if (status === 'failed') title = name + ' 失效';

  const neckNow = hsNeckAt(t1, t2, n - 1);
  const why = name +
    '：头 ' + px(head.price) +
    '，两肩 ' + px(ls.price) + ' / ' + px(rs.price) +
    '，颈线约 ' + px(neckNow) +
    (status === 'confirmed'
      ? ('。收盘已穿过颈线，量度 ' + px(target) + (targetHit ? '，价格已经走到这一带。' : '。'))
      : (status === 'failed'
        ? '。价格重新越过头部，形态失效。'
        : '。右肩已现，还要等收盘穿过颈线才算完成。'));

  return {
    kind: kind,
    status: status,
    ls: ls,
    t1: t1,
    head: head,
    t2: t2,
    rs: rs,
    breakI: ev.breakI,
    failI: ev.failI,
    target: target,
    height: height,
    targetHit: targetHit,
    liveRs: !!liveRs,
    title: title,
    why: why,
    score: hdH / Math.max(atrv, 1e-6) * (0.55 + 0.45 * sym) * (1 - tSym * 0.35) * (status === 'confirmed' ? 1.15 : 1) * (liveRs ? 0.86 : 1),
  };
}

export function computeHs(klines) {
  const empty = { patterns: [], label: '头肩未现', vote: 0, why: '摆动点还不够，或两肩、头部、颈线对不齐。' };
  if (!klines || klines.length < 20) return empty;
  const lastPx = klines[klines.length - 1].c;
  const atrv = atr(klines, 14) || atrFallback(lastPx);
  const k = hsPivotK(state.tf);
  const pivots = hsPivots(klines, k);
  const found = [];

  function pushPat(p) {
    if (!p) return;
    for (let i = 0; i < found.length; i++) {
      if (found[i].kind === p.kind && Math.abs(found[i].head.i - p.head.i) <= 2) {
        if (p.score > found[i].score) found[i] = p;
        return;
      }
    }
    found.push(p);
  }

  for (let i = 0; i <= pivots.length - 5; i++) {
    const a = pivots[i], b = pivots[i + 1], c = pivots[i + 2], d = pivots[i + 3], e = pivots[i + 4];
    if (a.kind === 'h' && b.kind === 'l' && c.kind === 'h' && d.kind === 'l' && e.kind === 'h') {
      pushPat(hsBuild(klines, a, b, c, d, e, 'top', atrv, false));
    }
    if (a.kind === 'l' && b.kind === 'h' && c.kind === 'l' && d.kind === 'h' && e.kind === 'l') {
      pushPat(hsBuild(klines, a, b, c, d, e, 'bottom', atrv, false));
    }
  }

  if (pivots.length >= 4) {
    const a = pivots[pivots.length - 4];
    const b = pivots[pivots.length - 3];
    const c = pivots[pivots.length - 2];
    const d = pivots[pivots.length - 1];
    if (a.kind === 'h' && b.kind === 'l' && c.kind === 'h' && d.kind === 'l') {
      const rs = hsLiveShoulder(klines, d, c, 'top', atrv);
      if (rs) pushPat(hsBuild(klines, a, b, c, d, rs, 'top', atrv, true));
    }
    if (a.kind === 'l' && b.kind === 'h' && c.kind === 'l' && d.kind === 'h') {
      const rs = hsLiveShoulder(klines, d, c, 'bottom', atrv);
      if (rs) pushPat(hsBuild(klines, a, b, c, d, rs, 'bottom', atrv, true));
    }
  }

  if (!found.length) return empty;
  const n = klines.length;
  const keep = found.filter((p) => {
    if (p.status === 'forming') return true;
    const edge = p.breakI != null ? p.breakI : (p.failI != null ? p.failI : p.rs.i);
    return n - 1 - edge <= Math.max(36, Math.round(n * 0.28));
  });
  if (!keep.length) return empty;
  keep.sort((a, b) => {
    const rank = (p) => {
      if (p.status === 'confirmed' && !p.targetHit) return 3;
      if (p.status === 'confirmed') return 2;
      if (p.status === 'forming') return 1;
      return 0;
    };
    const ra = rank(a), rb = rank(b);
    if (rb !== ra) return rb - ra;
    if (b.rs.i !== a.rs.i) return b.rs.i - a.rs.i;
    return b.score - a.score;
  });
  const patterns = keep.slice(0, 2);
  const top = patterns[0];
  let vote = 0;
  if (top.status === 'confirmed' && !top.targetHit) vote = top.kind === 'top' ? -1 : 1;
  return {
    patterns: patterns,
    label: top.title,
    vote: vote,
    why: top.why,
  };
}

export function getHs(klines) {
  const last = klines[klines.length - 1];
  const key = [klines.length, last && last.t, last && last.c, last && last.h, last && last.l, state.tf].join(':');
  if (state._hsKey === key && state._hs) return state._hs;
  const pack = computeHs(klines);
  state._hsKey = key;
  state._hs = pack;
  return pack;
}
