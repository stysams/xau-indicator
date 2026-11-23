import { pbClosedEnd } from '../core/bars.js';
import { atrFallback, px } from '../core/format.js';
import { atr, pivotPoints, significantPivots } from '../core/math.js';
import { mkt, state } from '../state.js';
import { computeHs, hsNeckAt } from './hs.js';

export const PAT_SR_SOURCES = ['all', 'struct', 'candle'];
export const PAT_SR_SIDES = ['both', 'sup'];

export function normalizePatSrSource(v) {
  return PAT_SR_SOURCES.indexOf(v) >= 0 ? v : 'all';
}

export function normalizePatSrSide(v) {
  return PAT_SR_SIDES.indexOf(v) >= 0 ? v : 'both';
}

export function patSrPivotK(tf) {
  if (tf === '10s') return 5;
  if (tf === '1m' || tf === '3m' || tf === '5m') return 3;
  return 2;
}

export function patSrEmpty(source, side, why) {
  const src = normalizePatSrSource(source);
  const sd = normalizePatSrSide(side);
  return {
    ok: false,
    source: src,
    side: sd,
    sig: 'empty:' + src + ':' + sd,
    levels: [],
    trendlines: [],
    shapes: [],
    events: [],
    nearSup: null,
    nearRes: null,
    nearTest: null,
    atrv: 0,
    radius: 0,
    vote: 0,
    dir: 0,
    status: 'none',
    statusLab: '未现',
    label: '形态支撑未现',
    title: '形态支撑未现',
    why: why || '尚未形成符合门槛的价格结构或反转 K 线形态支撑压力。',
  };
}

function candleMetrics(k) {
  const hi = Math.max(k.o, k.c);
  const lo = Math.min(k.o, k.c);
  const range = Math.max(0, k.h - k.l);
  const body = Math.abs(k.c - k.o);
  const upWick = Math.max(0, k.h - hi);
  const dnWick = Math.max(0, lo - k.l);
  return {
    o: k.o, h: k.h, l: k.l, c: k.c,
    hi: hi, lo: lo, range: range, body: body,
    upWick: upWick, dnWick: dnWick,
    bull: k.c > k.o, bear: k.c < k.o,
    closePos: range > 0 ? (k.c - k.l) / range : 0.5,
  };
}

function clampZone(lo, hi, atrv, lastPx) {
  let zLo = Math.min(lo, hi);
  let zHi = Math.max(lo, hi);
  const mid = (zLo + zHi) / 2;
  const minW = Math.max(atrv * 0.24, lastPx * 0.00014);
  const maxW = Math.max(atrv * 1.10, lastPx * 0.00070);
  const w = zHi - zLo;
  if (w < minW) {
    zLo = mid - minW / 2;
    zHi = mid + minW / 2;
  } else if (w > maxW) {
    zLo = mid - maxW / 2;
    zHi = mid + maxW / 2;
  }
  return { lo: zLo, hi: zHi, price: (zLo + zHi) / 2 };
}

function detectDoubleTriplePatterns(klines, pivots, atrv, lastPx) {
  const zones = [];
  const shapes = [];
  const zoneTol = Math.max(atrv * 0.65, lastPx * 0.00042);
  const minDepth = Math.max(atrv * 1.05, lastPx * 0.00035);
  const pad = Math.max(atrv * 0.16, lastPx * 0.00010);
  const usedTriple = new Set();

  // 1. 三重底 / 三重顶
  for (let i = 0; i <= pivots.length - 5; i++) {
    const a = pivots[i];
    const b = pivots[i + 1];
    const c = pivots[i + 2];
    const d = pivots[i + 3];
    const e = pivots[i + 4];
    if (e.i - a.i < 8) continue;

    if (a.kind === 'l' && b.kind === 'h' && c.kind === 'l' && d.kind === 'h' && e.kind === 'l') {
      const lows = [a.price, c.price, e.price];
      const loMin = Math.min.apply(null, lows);
      const loMax = Math.max.apply(null, lows);
      const neckPx = (b.price + d.price) / 2;
      const depth = neckPx - loMin;
      if (loMax - loMin <= zoneTol * 1.25 && depth >= minDepth) {
        const z = clampZone(loMin - pad, loMax + pad, atrv, lastPx);
        const id = 'tb:' + a.i + ':' + e.i;
        usedTriple.add('l:' + c.i);
        usedTriple.add('l:' + e.i);
        shapes.push({
          id: id, code: 'triple_bottom', name: '三重底', dir: 1,
          points: [a, b, c, d, e], startI: a.i, endI: e.i,
          basePrice: z.price, neckPrice: neckPx,
        });
        zones.push({
          id: id, code: 'triple_bottom', name: '三重底', category: 'struct',
          origRole: 'sup', startI: a.i, formedI: e.i,
          price: z.price, zoneLo: z.lo, zoneHi: z.hi,
          priority: 4.2, shapeId: id,
          anchors: [a, c, e],
        });
        const nz = clampZone(neckPx - pad, neckPx + pad, atrv, lastPx);
        zones.push({
          id: id + ':neck', code: 'triple_bottom_neck', name: '三重底颈线', category: 'struct',
          origRole: 'res', startI: b.i, formedI: e.i,
          price: nz.price, zoneLo: nz.lo, zoneHi: nz.hi,
          priority: 3.1, shapeId: id, isNeck: true,
          anchors: [b, d],
        });
      }
    }

    if (a.kind === 'h' && b.kind === 'l' && c.kind === 'h' && d.kind === 'l' && e.kind === 'h') {
      const highs = [a.price, c.price, e.price];
      const hiMin = Math.min.apply(null, highs);
      const hiMax = Math.max.apply(null, highs);
      const neckPx = (b.price + d.price) / 2;
      const depth = hiMax - neckPx;
      if (hiMax - hiMin <= zoneTol * 1.25 && depth >= minDepth) {
        const z = clampZone(hiMin - pad, hiMax + pad, atrv, lastPx);
        const id = 'tt:' + a.i + ':' + e.i;
        usedTriple.add('h:' + c.i);
        usedTriple.add('h:' + e.i);
        shapes.push({
          id: id, code: 'triple_top', name: '三重顶', dir: -1,
          points: [a, b, c, d, e], startI: a.i, endI: e.i,
          basePrice: z.price, neckPrice: neckPx,
        });
        zones.push({
          id: id, code: 'triple_top', name: '三重顶', category: 'struct',
          origRole: 'res', startI: a.i, formedI: e.i,
          price: z.price, zoneLo: z.lo, zoneHi: z.hi,
          priority: 4.2, shapeId: id,
          anchors: [a, c, e],
        });
        const nz = clampZone(neckPx - pad, neckPx + pad, atrv, lastPx);
        zones.push({
          id: id + ':neck', code: 'triple_top_neck', name: '三重顶颈线', category: 'struct',
          origRole: 'sup', startI: b.i, formedI: e.i,
          price: nz.price, zoneLo: nz.lo, zoneHi: nz.hi,
          priority: 3.1, shapeId: id, isNeck: true,
          anchors: [b, d],
        });
      }
    }
  }

  // 2. W底 (双底) / M顶 (双顶)
  for (let i = 0; i <= pivots.length - 3; i++) {
    const a = pivots[i];
    const b = pivots[i + 1];
    const c = pivots[i + 2];
    if (c.i - a.i < 4) continue;

    if (a.kind === 'l' && b.kind === 'h' && c.kind === 'l') {
      if (usedTriple.has('l:' + c.i)) continue;
      const loMin = Math.min(a.price, c.price);
      const loMax = Math.max(a.price, c.price);
      const depth = b.price - loMin;
      if (loMax - loMin <= zoneTol && depth >= minDepth) {
        const z = clampZone(loMin - pad, loMax + pad, atrv, lastPx);
        const id = 'db:' + a.i + ':' + c.i;
        shapes.push({
          id: id, code: 'double_bottom', name: 'W底', dir: 1,
          points: [a, b, c], startI: a.i, endI: c.i,
          basePrice: z.price, neckPrice: b.price,
        });
        zones.push({
          id: id, code: 'double_bottom', name: 'W底', category: 'struct',
          origRole: 'sup', startI: a.i, formedI: c.i,
          price: z.price, zoneLo: z.lo, zoneHi: z.hi,
          priority: 3.6, shapeId: id,
          anchors: [a, c],
        });
        const nz = clampZone(b.price - pad, b.price + pad, atrv, lastPx);
        zones.push({
          id: id + ':neck', code: 'double_bottom_neck', name: 'W底颈线', category: 'struct',
          origRole: 'res', startI: b.i, formedI: c.i,
          price: nz.price, zoneLo: nz.lo, zoneHi: nz.hi,
          priority: 2.7, shapeId: id, isNeck: true,
          anchors: [b],
        });
      }
    }

    if (a.kind === 'h' && b.kind === 'l' && c.kind === 'h') {
      if (usedTriple.has('h:' + c.i)) continue;
      const hiMin = Math.min(a.price, c.price);
      const hiMax = Math.max(a.price, c.price);
      const depth = hiMax - b.price;
      if (hiMax - hiMin <= zoneTol && depth >= minDepth) {
        const z = clampZone(hiMin - pad, hiMax + pad, atrv, lastPx);
        const id = 'dt:' + a.i + ':' + c.i;
        shapes.push({
          id: id, code: 'double_top', name: 'M顶', dir: -1,
          points: [a, b, c], startI: a.i, endI: c.i,
          basePrice: z.price, neckPrice: b.price,
        });
        zones.push({
          id: id, code: 'double_top', name: 'M顶', category: 'struct',
          origRole: 'res', startI: a.i, formedI: c.i,
          price: z.price, zoneLo: z.lo, zoneHi: z.hi,
          priority: 3.6, shapeId: id,
          anchors: [a, c],
        });
        const nz = clampZone(b.price - pad, b.price + pad, atrv, lastPx);
        zones.push({
          id: id + ':neck', code: 'double_top_neck', name: 'M顶颈线', category: 'struct',
          origRole: 'sup', startI: b.i, formedI: c.i,
          price: nz.price, zoneLo: nz.lo, zoneHi: nz.hi,
          priority: 2.7, shapeId: id, isNeck: true,
          anchors: [b],
        });
      }
    }
  }

  return { zones: zones, shapes: shapes };
}

function detectHsPatterns(closedKlines, atrv, lastPx, end) {
  const zones = [];
  const trendlines = [];
  const shapes = [];
  const hs = computeHs(closedKlines);
  if (!hs || !hs.patterns || !hs.patterns.length) return { zones: zones, trendlines: trendlines, shapes: shapes };
  const pad = Math.max(atrv * 0.18, lastPx * 0.00011);

  hs.patterns.forEach((p) => {
    if (!p || p.status === 'failed') return;
    const isBottom = p.kind === 'bottom';
    const dI = p.t2.i - p.t1.i;
    if (dI <= 0) return;
    const slope = (p.t2.price - p.t1.price) / dI;
    const intercept = p.t1.price - slope * p.t1.i;
    const neckNow = hsNeckAt(p.t1, p.t2, end);
    const id = 'hs:' + p.kind + ':' + p.head.i;

    shapes.push({
      id: id,
      code: isBottom ? 'hs_bottom' : 'hs_top',
      name: isBottom ? '头肩底' : '头肩顶',
      dir: isBottom ? 1 : -1,
      points: [p.ls, p.t1, p.head, p.t2, p.rs],
      startI: p.ls.i,
      endI: p.rs.i,
      basePrice: p.head.price,
      neckPrice: neckNow,
    });

    trendlines.push({
      id: id + ':neck',
      code: isBottom ? 'hs_bottom_neck' : 'hs_top_neck',
      name: isBottom ? '头肩底颈线' : '头肩顶颈线',
      category: 'struct',
      origRole: isBottom ? 'res' : 'sup',
      startI: p.t1.i,
      formedI: p.rs.i,
      slope: slope,
      intercept: intercept,
      anchors: [p.t1, p.t2],
      priority: 3.8,
    });

    const hz = clampZone(p.head.price - pad, p.head.price + pad, atrv, lastPx);
    zones.push({
      id: id + ':head',
      code: isBottom ? 'hs_bottom_head' : 'hs_top_head',
      name: isBottom ? '头肩底' : '头肩顶',
      category: 'struct',
      origRole: isBottom ? 'sup' : 'res',
      startI: p.head.i,
      formedI: p.rs.i,
      price: hz.price,
      zoneLo: hz.lo,
      zoneHi: hz.hi,
      priority: 3.5,
      shapeId: id,
      anchors: [p.head],
    });
  });

  return { zones: zones, trendlines: trendlines, shapes: shapes };
}

function fitTrendlineSide(klines, pts, kind, atrv, lastPx, end) {
  if (!pts || pts.length < 2) return null;
  const isSup = kind === 'l';
  const touchTol = Math.max(atrv * 0.42, lastPx * 0.00025);
  const violTol = Math.max(atrv * 0.48, lastPx * 0.00030);
  const minSlopeMove = Math.max(atrv * 0.55, lastPx * 0.00022);
  const recentPts = pts.slice(-8);
  let best = null;

  for (let a = 0; a < recentPts.length - 1; a++) {
    for (let b = a + 1; b < recentPts.length; b++) {
      const p1 = recentPts[a];
      const p2 = recentPts[b];
      const span = p2.i - p1.i;
      if (span < 6) continue;
      if (isSup && p2.price <= p1.price) continue;
      if (!isSup && p2.price >= p1.price) continue;
      const slope = (p2.price - p1.price) / span;
      if (Math.abs(slope) * span < minSlopeMove) continue;
      const intercept = p1.price - slope * p1.i;

      // 锚点区间内收盘不能明显跌穿/升破该趋势线
      let innerBreak = false;
      for (let i = p1.i + 1; i < p2.i; i++) {
        const lp = intercept + slope * i;
        if (isSup && klines[i].c < lp - violTol) { innerBreak = true; break; }
        if (!isSup && klines[i].c > lp + violTol) { innerBreak = true; break; }
      }
      if (innerBreak) continue;

      const anchors = [];
      for (let k = 0; k < recentPts.length; k++) {
        const pk = recentPts[k];
        if (pk.i < p1.i) continue;
        const lp = intercept + slope * pk.i;
        if (Math.abs(pk.price - lp) <= touchTol) anchors.push(pk);
      }
      if (anchors.length < 2) continue;

      const endPx = intercept + slope * end;
      if (!Number.isFinite(endPx) || !(endPx > 0)) continue;
      const distEnd = Math.abs(lastPx - endPx);
      if (distEnd > Math.max(atrv * 8, lastPx * 0.012)) continue;

      const recency = 1 - Math.min(1, (end - anchors[anchors.length - 1].i) / Math.max(20, end + 1));
      const score = anchors.length * 2.4 + recency * 1.6 + Math.min(1.5, span / 24) - (distEnd / Math.max(atrv * 4, 1e-6)) * 0.45;
      if (!best || score > best.score) {
        best = {
          id: (isSup ? 'tl-sup:' : 'tl-res:') + p1.i + ':' + p2.i,
          code: isSup ? 'trend_sup' : 'trend_res',
          name: isSup ? '上升支撑线' : '下降压力线',
          category: 'struct',
          origRole: isSup ? 'sup' : 'res',
          startI: p1.i,
          formedI: anchors[anchors.length - 1].i,
          slope: slope,
          intercept: intercept,
          anchors: anchors,
          priority: anchors.length >= 3 ? 3.9 : 3.0,
          score: score,
        };
      }
    }
  }
  return best;
}

function detectTrendlinePatterns(closedKlines, pivots, atrv, lastPx, end) {
  const lows = pivots.filter((p) => p.kind === 'l');
  const highs = pivots.filter((p) => p.kind === 'h');
  const supLine = fitTrendlineSide(closedKlines, lows, 'l', atrv, lastPx, end);
  const resLine = fitTrendlineSide(closedKlines, highs, 'h', atrv, lastPx, end);

  if (supLine && resLine) {
    const startMax = Math.max(supLine.startI, resLine.startI);
    const endMin = Math.min(end, Math.max(supLine.formedI, resLine.formedI) + 30);
    const gapStart = (resLine.intercept + resLine.slope * startMax) - (supLine.intercept + supLine.slope * startMax);
    const gapEnd = (resLine.intercept + resLine.slope * endMin) - (supLine.intercept + supLine.slope * endMin);
    if (gapStart > 0 && gapEnd > 0 && gapEnd < gapStart * 0.85) {
      supLine.code = 'triangle_sup';
      supLine.name = '收敛三角下沿';
      supLine.priority += 0.45;
      resLine.code = 'triangle_res';
      resLine.name = '收敛三角上沿';
      resLine.priority += 0.45;
    }
  }

  return [supLine, resLine].filter(Boolean);
}

function detectCandlePatternZones(closedKlines, atrv, lastPx, end) {
  const zones = [];
  const floor = (mkt && mkt().atrFloor) || 0.4;
  const at = Math.max(atrv || 0, floor * 0.5, lastPx * 0.00018);
  const scanFrom = Math.max(6, end - 72);

  for (let i = scanFrom; i <= end; i++) {
    const k0 = closedKlines[i];
    const k1 = closedKlines[i - 1];
    const k2 = closedKlines[i - 2];
    const m0 = candleMetrics(k0);
    const m1 = candleMetrics(k1);
    const m2 = candleMetrics(k2);
    if (m0.range < at * 0.42 || m0.range > at * 3.6) continue;

    let prevHi = -Infinity;
    let prevLo = Infinity;
    for (let j = i - 6; j < i; j++) {
      if (closedKlines[j].h > prevHi) prevHi = closedKlines[j].h;
      if (closedKlines[j].l < prevLo) prevLo = closedKlines[j].l;
    }
    const nearLo = Math.min(k0.l, k1.l) <= prevLo + at * 0.22;
    const nearHi = Math.max(k0.h, k1.h) >= prevHi - at * 0.22;

    let hit = null;

    // 1. 启明星 / 黄昏之星
    if (nearLo && m2.bear && m2.body >= at * 0.50 && m0.bull && m0.body >= at * 0.42) {
      const starSmall = m1.body <= Math.max(m2.body * 0.42, at * 0.35);
      const starLow = m1.l <= Math.min(m2.l, m0.l) + at * 0.15;
      const mid2 = (m2.o + m2.c) / 2;
      if (starSmall && starLow && m0.c >= mid2) {
        const z = clampZone(Math.min(m2.l, m1.l, m0.l), Math.max(m1.hi, m0.o), at, lastPx);
        hit = {
          code: 'morning_star', name: '启明星', origRole: 'sup', priority: 3.1,
          startI: i - 2, formedI: i, zone: z,
        };
      }
    } else if (nearHi && m2.bull && m2.body >= at * 0.50 && m0.bear && m0.body >= at * 0.42) {
      const starSmall = m1.body <= Math.max(m2.body * 0.42, at * 0.35);
      const starHigh = m1.h >= Math.max(m2.h, m0.h) - at * 0.15;
      const mid2 = (m2.o + m2.c) / 2;
      if (starSmall && starHigh && m0.c <= mid2) {
        const z = clampZone(Math.min(m1.lo, m0.o), Math.max(m2.h, m1.h, m0.h), at, lastPx);
        hit = {
          code: 'evening_star', name: '黄昏之星', origRole: 'res', priority: 3.1,
          startI: i - 2, formedI: i, zone: z,
        };
      }
    }

    // 2. 看涨吞没 / 看跌吞没
    if (!hit && nearLo && m1.bear && m0.bull && m0.body >= at * 0.48 && m0.body > m1.body * 1.08 &&
        m0.c >= m1.o && m0.o <= m1.c + at * 0.10) {
      const z = clampZone(Math.min(k0.l, k1.l), Math.max(m1.lo, m0.o) + Math.min(m1.body * 0.45, at * 0.35), at, lastPx);
      hit = {
        code: 'bull_engulf', name: '看涨吞没', origRole: 'sup', priority: 2.75,
        startI: i - 1, formedI: i, zone: z,
      };
    } else if (!hit && nearHi && m1.bull && m0.bear && m0.body >= at * 0.48 && m0.body > m1.body * 1.08 &&
        m0.c <= m1.o && m0.o >= m1.c - at * 0.10) {
      const z = clampZone(Math.min(m1.hi, m0.o) - Math.min(m1.body * 0.45, at * 0.35), Math.max(k0.h, k1.h), at, lastPx);
      hit = {
        code: 'bear_engulf', name: '看跌吞没', origRole: 'res', priority: 2.75,
        startI: i - 1, formedI: i, zone: z,
      };
    }

    // 3. 扫低收回 / 扫高收回 (Liquidity Sweep)
    if (!hit && k0.l < prevLo - at * 0.06 && k0.c > prevLo + at * 0.05 &&
        m0.dnWick >= m0.range * 0.38 && m0.closePos >= 0.60) {
      const z = clampZone(k0.l, Math.max(prevLo, m0.lo), at, lastPx);
      hit = {
        code: 'sweep_up', name: '扫低收回', origRole: 'sup', priority: 2.95,
        startI: i, formedI: i, zone: z,
      };
    } else if (!hit && k0.h > prevHi + at * 0.06 && k0.c < prevHi - at * 0.05 &&
        m0.upWick >= m0.range * 0.38 && m0.closePos <= 0.40) {
      const z = clampZone(Math.min(prevHi, m0.hi), k0.h, at, lastPx);
      hit = {
        code: 'sweep_dn', name: '扫高收回', origRole: 'res', priority: 2.95,
        startI: i, formedI: i, zone: z,
      };
    }

    // 4. 平底 / 平顶 (Tweezer)
    if (!hit && nearLo && m1.bear && m0.bull && m0.body >= at * 0.35 && m1.body >= at * 0.30 &&
        Math.abs(k0.l - k1.l) <= at * 0.14 && m0.closePos >= 0.58) {
      const z = clampZone(Math.min(k0.l, k1.l), Math.min(m0.lo, m1.lo) + at * 0.25, at, lastPx);
      hit = {
        code: 'tweezer_bottom', name: '平底', origRole: 'sup', priority: 2.55,
        startI: i - 1, formedI: i, zone: z,
      };
    } else if (!hit && nearHi && m1.bull && m0.bear && m0.body >= at * 0.35 && m1.body >= at * 0.30 &&
        Math.abs(k0.h - k1.h) <= at * 0.14 && m0.closePos <= 0.42) {
      const z = clampZone(Math.max(m0.hi, m1.hi) - at * 0.25, Math.max(k0.h, k1.h), at, lastPx);
      hit = {
        code: 'tweezer_top', name: '平顶', origRole: 'res', priority: 2.55,
        startI: i - 1, formedI: i, zone: z,
      };
    }

    // 5. 锤子线 / 流星线 (含 A6 实体下限，防止十字星误触发)
    if (!hit && m0.range >= at * 0.65 && m0.body >= at * 0.08) {
      if (nearLo && m0.dnWick >= m0.body * 2.0 && m0.dnWick >= m0.range * 0.55 &&
          m0.upWick <= m0.range * 0.25 && m0.closePos >= 0.62) {
        const z = clampZone(k0.l, m0.lo, at, lastPx);
        hit = {
          code: 'hammer', name: '锤子线', origRole: 'sup', priority: 2.45,
          startI: i, formedI: i, zone: z,
        };
      } else if (nearHi && m0.upWick >= m0.body * 2.0 && m0.upWick >= m0.range * 0.55 &&
          m0.dnWick <= m0.range * 0.25 && m0.closePos <= 0.38) {
        const z = clampZone(m0.hi, k0.h, at, lastPx);
        hit = {
          code: 'shooting_star', name: '流星线', origRole: 'res', priority: 2.45,
          startI: i, formedI: i, zone: z,
        };
      }
    }

    if (hit) {
      zones.push({
        id: hit.code + ':' + hit.formedI,
        code: hit.code,
        name: hit.name,
        category: 'candle',
        origRole: hit.origRole,
        startI: hit.startI,
        formedI: hit.formedI,
        price: hit.zone.price,
        zoneLo: hit.zone.lo,
        zoneHi: hit.zone.hi,
        priority: hit.priority,
        anchors: [{ i: hit.formedI, kind: hit.origRole === 'sup' ? 'l' : 'h', price: hit.origRole === 'sup' ? k0.l : k0.h }],
      });
    }
  }

  return zones;
}

export function patSrEvalZone(klines, zone, end, thresh) {
  let role = zone.origRole;
  let breakI = null;
  let breakDir = 0;
  let flipCount = 0;
  let touches = Math.max(1, (zone.anchors || []).length);
  let rejections = 0;
  let lastTouchI = zone.formedI;
  let lastRejectI = -1;
  let lastRejectDir = 0;
  const breakEvents = [];
  const holdEvents = [];

  for (let i = zone.formedI + 1; i <= end; i++) {
    const bar = klines[i];
    if (role === 'sup' && bar.c < zone.zoneLo - thresh) {
      role = 'res';
      breakI = i;
      breakDir = -1;
      flipCount += 1;
      breakEvents.push({ i: i, dir: -1, from: 'sup', to: 'res' });
      continue;
    }
    if (role === 'res' && bar.c > zone.zoneHi + thresh) {
      role = 'sup';
      breakI = i;
      breakDir = 1;
      flipCount += 1;
      breakEvents.push({ i: i, dir: 1, from: 'res', to: 'sup' });
      continue;
    }

    if (bar.h < zone.zoneLo || bar.l > zone.zoneHi) continue;
    const bounceSup = role === 'sup' && bar.l <= zone.zoneHi && bar.c >= zone.zoneLo && (bar.o >= zone.zoneLo || bar.c > zone.zoneHi);
    const bounceRes = role === 'res' && bar.h >= zone.zoneLo && bar.c <= zone.zoneHi && (bar.o <= zone.zoneHi || bar.c < zone.zoneLo);
    if (!(bounceSup || bounceRes)) continue;
    if (i - lastTouchI <= 2) continue;
    touches += 1;
    rejections += 1;
    lastTouchI = i;
    lastRejectI = i;
    lastRejectDir = bounceSup ? 1 : -1;
    holdEvents.push({ i: i, dir: lastRejectDir, price: zone.price });
  }

  return {
    structRole: role,
    breakI: breakI,
    breakDir: breakDir,
    flipCount: flipCount,
    touches: touches,
    rejections: rejections,
    lastTouchI: lastTouchI,
    lastRejectI: lastRejectI,
    lastRejectDir: lastRejectDir,
    breakEvents: breakEvents,
    holdEvents: holdEvents,
  };
}

export function patSrEvalTrendline(klines, tl, end, atrv, lastPx, thresh) {
  let role = tl.origRole;
  let breakI = null;
  let breakDir = 0;
  let flipCount = 0;
  const band = Math.max(atrv * 0.28, lastPx * 0.00018);
  let touches = Math.max(2, (tl.anchors || []).length);
  let rejections = 0;
  let lastTouchI = tl.formedI;
  let lastRejectI = -1;
  let lastRejectDir = 0;

  for (let i = tl.formedI + 1; i <= end; i++) {
    const bar = klines[i];
    const lp = tl.intercept + tl.slope * i;
    if (role === 'sup' && bar.c < lp - thresh) {
      role = 'res';
      breakI = i;
      breakDir = -1;
      flipCount += 1;
      continue;
    }
    if (role === 'res' && bar.c > lp + thresh) {
      role = 'sup';
      breakI = i;
      breakDir = 1;
      flipCount += 1;
      continue;
    }
    const bounceSup = role === 'sup' && bar.l <= lp + band && bar.c >= lp - band * 0.35;
    const bounceRes = role === 'res' && bar.h >= lp - band && bar.c <= lp + band * 0.35;
    if (!(bounceSup || bounceRes)) continue;
    if (i - lastTouchI <= 2) continue;
    touches += 1;
    rejections += 1;
    lastTouchI = i;
    lastRejectI = i;
    lastRejectDir = bounceSup ? 1 : -1;
  }

  const priceNow = tl.intercept + tl.slope * end;
  return Object.assign({}, tl, {
    price: priceNow,
    priceStart: tl.intercept + tl.slope * tl.startI,
    priceEnd: priceNow,
    endI: end,
    structRole: role,
    breakI: breakI,
    breakDir: breakDir,
    flipCount: flipCount,
    touches: touches,
    rejections: rejections,
    lastTouchI: lastTouchI,
    lastRejectI: lastRejectI,
    lastRejectDir: lastRejectDir,
  });
}

function mergePatternZones(evaluated, mergeRadius, atrv, lastPx) {
  if (!evaluated.length) return [];
  const sorted = evaluated.slice().sort((a, b) => b.priority - a.priority || b.formedI - a.formedI);
  const merged = [];
  const maxZoneW = Math.max(atrv * 1.35, lastPx * 0.00085);

  sorted.forEach((z) => {
    let target = null;
    for (let i = 0; i < merged.length; i++) {
      const m = merged[i];
      if (m.structRole !== z.structRole) continue;
      if (Math.abs(m.price - z.price) > mergeRadius) continue;
      const nextLo = Math.min(m.zoneLo, z.zoneLo);
      const nextHi = Math.max(m.zoneHi, z.zoneHi);
      if (nextHi - nextLo > maxZoneW) continue;
      target = m;
      break;
    }
    if (!target) {
      merged.push(Object.assign({}, z, {
        names: [z.name],
        codes: [z.code],
        categories: [z.category],
        confluence: 1,
      }));
      return;
    }
    if (target.names.indexOf(z.name) < 0) target.names.push(z.name);
    if (target.codes.indexOf(z.code) < 0) target.codes.push(z.code);
    if (target.categories.indexOf(z.category) < 0) target.categories.push(z.category);
    target.confluence += 1;
    target.zoneLo = Math.min(target.zoneLo, z.zoneLo);
    target.zoneHi = Math.max(target.zoneHi, z.zoneHi);
    target.price = (target.zoneLo + target.zoneHi) / 2;
    target.startI = Math.min(target.startI, z.startI);
    target.formedI = Math.max(target.formedI, z.formedI);
    target.touches = Math.max(target.touches, z.touches) + 1;
    target.rejections = Math.max(target.rejections, z.rejections);
    target.lastTouchI = Math.max(target.lastTouchI, z.lastTouchI);
    if (z.lastRejectI > target.lastRejectI) {
      target.lastRejectI = z.lastRejectI;
      target.lastRejectDir = z.lastRejectDir;
    }
    if (z.breakI != null && (target.breakI == null || z.breakI > target.breakI)) {
      target.breakI = z.breakI;
      target.breakDir = z.breakDir;
    }
    target.flipCount = Math.max(target.flipCount, z.flipCount);
    target.priority = Math.max(target.priority, z.priority) + 0.55;
    if (z.shapeId && !target.shapeId) target.shapeId = z.shapeId;
  });

  return merged.map((m) => {
    const labelName = m.names.length > 2 ? (m.names.slice(0, 2).join('+') + '等') : m.names.join('+');
    return Object.assign({}, m, { name: labelName });
  });
}

export function patSrTitle(lv, lastPx) {
  if (!lv) return '';
  const asSup = lv.role === 'sup' || (lv.role === 'test' && (lastPx == null ? lv.structRole === 'sup' : lastPx >= lv.price));
  const flipped = lv.flipCount > 0 ? '转换' : '';
  const roleWord = asSup ? '支撑' : '压力';
  const prefix = lv.role === 'test' ? '测试' : '';
  return prefix + lv.name + '·' + flipped + roleWord + ' ' + px(lv.price);
}

export function computePatSr(klines, opts) {
  const source = normalizePatSrSource(opts && opts.source != null ? opts.source : state.patSrSource);
  const side = normalizePatSrSide(opts && opts.side != null ? opts.side : state.patSrSide);
  const empty = patSrEmpty(source, side);
  if (!klines || klines.length < 18) return empty;

  const n = klines.length;
  const end = pbClosedEnd(klines);
  if (end < 14) return empty;
  const closed = klines.slice(0, end + 1);
  const lastClosed = closed[end];
  const lastBar = klines[n - 1];
  const last = lastBar.c;
  const hasForming = end < n - 1;

  const atrv = atr(closed, 14) || atrFallback(lastClosed.c);
  const radius = Math.max(atrv * 0.40, lastClosed.c * 0.00024);
  const thresh = Math.max(atrv * 0.24, lastClosed.c * 0.00016);
  const nearBand = Math.max(radius, atrv * 0.45);
  const k = patSrPivotK(state.tf);
  const minMove = Math.max(atrv * 0.65, lastClosed.c * 0.00026);
  const pivots = significantPivots(pivotPoints(closed, k), minMove);

  let rawZones = [];
  let rawLines = [];
  let allShapes = [];

  if (source === 'all' || source === 'struct') {
    const dt = detectDoubleTriplePatterns(closed, pivots, atrv, lastClosed.c);
    rawZones = rawZones.concat(dt.zones);
    allShapes = allShapes.concat(dt.shapes);

    const hs = detectHsPatterns(closed, atrv, lastClosed.c, end);
    rawZones = rawZones.concat(hs.zones);
    rawLines = rawLines.concat(hs.trendlines);
    allShapes = allShapes.concat(hs.shapes);

    const tls = detectTrendlinePatterns(closed, pivots, atrv, lastClosed.c, end);
    rawLines = rawLines.concat(tls);
  }

  if (source === 'all' || source === 'candle') {
    rawZones = rawZones.concat(detectCandlePatternZones(closed, atrv, lastClosed.c, end));
  }

  // 评估已收盘 K 线上的破位、顶底转换与回踩企稳
  const evalZones = [];
  rawZones.forEach((z) => {
    const ev = patSrEvalZone(closed, z, end, thresh);
    const age = end - ev.lastTouchI;
    // 淘汰反复被穿或陈旧失守的 K 线形态带，保持画面高信噪比
    if (z.category === 'candle') {
      if (ev.flipCount >= 2) return;
      if (ev.flipCount === 1 && ev.rejections === 0 && (end - ev.breakI) > 24) return;
      if (age > 64 && ev.touches < 2) return;
    } else {
      if (ev.flipCount >= 3) return;
      if (ev.breakI != null && (end - ev.breakI) > Math.max(48, Math.round(closed.length * 0.40)) && ev.rejections === 0) return;
    }
    evalZones.push(Object.assign({}, z, ev));
  });

  const merged = mergePatternZones(evalZones, Math.max(radius * 1.15, atrv * 0.48), atrv, lastClosed.c);

  const scored = [];
  merged.forEach((lv) => {
    const dist = last < lv.zoneLo ? (lv.zoneLo - last) : (last > lv.zoneHi ? (last - lv.zoneHi) : 0);
    const close = dist <= nearBand;
    let role = lv.structRole;
    if (close) role = 'test';
    else if (last > lv.zoneHi) role = 'sup';
    else if (last < lv.zoneLo) role = 'res';

    const age = Math.max(0, end - lv.lastTouchI);
    const recency = 1.6 * (1 - Math.min(1, age / Math.max(16, closed.length * 0.65)));
    const distScore = 2.4 * (1 - Math.min(1, dist / Math.max(atrv * 4.5, radius * 5)));
    const hasBothCats = lv.categories.indexOf('struct') >= 0 && lv.categories.indexOf('candle') >= 0;
    const score = lv.priority + lv.touches * 0.65 + lv.rejections * 0.55 +
      (lv.confluence - 1) * 0.9 + (hasBothCats ? 0.85 : 0) + recency + distScore +
      (lv.flipCount === 0 ? 0.45 : (lv.flipCount === 1 ? 0.30 : 0)) +
      (role === 'test' ? 0.75 : 0);
    const strength = Math.round(Math.min(98, 32 + lv.priority * 6 + lv.touches * 5 + lv.rejections * 5 +
      (lv.confluence - 1) * 9 + (hasBothCats ? 8 : 0)));

    scored.push(Object.assign({}, lv, {
      role: role,
      distance: dist,
      score: score,
      strength: strength,
    }));
  });

  const evalLines = rawLines
    .map((tl) => patSrEvalTrendline(closed, tl, end, atrv, lastClosed.c, thresh))
    .filter((tl) => tl.flipCount <= 1 && Math.abs(last - tl.price) <= Math.max(atrv * 6, last * 0.01))
    .map((tl) => {
      const dist = Math.abs(last - tl.price);
      const role = dist <= nearBand ? 'test' : (last >= tl.price ? 'sup' : 'res');
      return Object.assign({}, tl, {
        role: role,
        distance: dist,
        score: tl.priority + tl.touches * 0.6 + tl.rejections * 0.5 + (tl.flipCount === 0 ? 0.5 : 0.2),
      });
    });

  // 按显示方向筛选（支+压 / 仅支撑）
  const keepZone = (lv) => {
    if (side === 'both') return true;
    return lv.role === 'sup' || (lv.role === 'test' && last >= lv.zoneLo - radius * 0.25 && lv.structRole === 'sup');
  };
  const keepLine = (tl) => {
    if (side === 'both') return true;
    return tl.role === 'sup' || (tl.role === 'test' && tl.structRole === 'sup');
  };

  const filteredZones = scored.filter(keepZone);
  const filteredLines = evalLines.filter(keepLine).sort((a, b) => b.score - a.score).slice(0, 2);

  const tests = filteredZones.filter((lv) => lv.role === 'test').sort((a, b) => b.score - a.score);
  const sups = filteredZones.filter((lv) => lv.role === 'sup').sort((a, b) => {
    if (Math.abs(a.distance - b.distance) <= radius) return b.score - a.score;
    return a.distance - b.distance;
  });
  const ress = filteredZones.filter((lv) => lv.role === 'res').sort((a, b) => {
    if (Math.abs(a.distance - b.distance) <= radius) return b.score - a.score;
    return a.distance - b.distance;
  });

  const nearTest = tests[0] || null;
  const nearSup = sups[0] || (nearTest && last >= nearTest.price ? nearTest : null);
  const nearRes = ress[0] || (nearTest && last < nearTest.price ? nearTest : null);

  const picked = [];
  function pushLevel(lv) {
    if (!lv) return;
    for (let i = 0; i < picked.length; i++) {
      if (Math.abs(picked[i].price - lv.price) <= radius) {
        if (lv.score > picked[i].score) picked[i] = lv;
        return;
      }
    }
    picked.push(lv);
  }

  pushLevel(nearTest);
  pushLevel(nearSup);
  if (side === 'both') pushLevel(nearRes);

  const maxSup = side === 'sup' ? 5 : 3;
  const maxRes = side === 'both' ? 3 : 0;
  const rest = filteredZones.filter((lv) => picked.indexOf(lv) < 0).sort((a, b) => b.score - a.score);
  for (let i = 0; i < rest.length && picked.length < 7; i++) {
    const lv = rest[i];
    const nSup = picked.filter((p) => p.role === 'sup').length;
    const nRes = picked.filter((p) => p.role === 'res').length;
    if (lv.role === 'sup' && nSup >= maxSup) continue;
    if (lv.role === 'res' && nRes >= maxRes) continue;
    pushLevel(lv);
  }
  picked.sort((a, b) => b.price - a.price);

  // 只保留与选出级别相关或最新的结构形态折线（最多 3 个），避免主图杂乱
  const activeShapeIds = new Set(picked.map((lv) => lv.shapeId).filter(Boolean));
  const pickedShapes = allShapes
    .filter((sh) => (side === 'both' || sh.dir > 0) && (activeShapeIds.has(sh.id) || (end - sh.endI) <= 45))
    .sort((a, b) => b.endI - a.endI)
    .slice(0, 3);

  if (!picked.length && !filteredLines.length) {
    return patSrEmpty(source, side, '当前周期与筛选下未检出有效形态支撑或压力。');
  }

  // 构建信号线事件（仅基于已收盘 K 线）
  const events = [];
  picked.forEach((lv) => {
    if (lv.breakI != null && end - lv.breakI <= 24) {
      events.push({
        i: lv.breakI,
        t: closed[lv.breakI] && closed[lv.breakI].t,
        dir: lv.breakDir,
        kind: 'patSr',
        eventType: 'break',
        lab: (lv.breakDir > 0 ? '上破' : '跌破') + lv.name + (lv.breakDir > 0 ? '压力' : '支撑'),
        price: lv.price,
      });
    }
    if (lv.lastRejectI >= 0 && end - lv.lastRejectI <= 24 && lv.lastRejectDir !== 0) {
      events.push({
        i: lv.lastRejectI,
        t: closed[lv.lastRejectI] && closed[lv.lastRejectI].t,
        dir: lv.lastRejectDir,
        kind: 'patSr',
        eventType: 'hold',
        lab: lv.name + (lv.lastRejectDir > 0 ? '支撑企稳' : '压力受阻'),
        price: lv.price,
      });
    }
  });
  filteredLines.forEach((tl) => {
    if (tl.breakI != null && end - tl.breakI <= 24) {
      const bp = tl.intercept + tl.slope * tl.breakI;
      events.push({
        i: tl.breakI,
        t: closed[tl.breakI] && closed[tl.breakI].t,
        dir: tl.breakDir,
        kind: 'patSr',
        eventType: 'break',
        lab: (tl.breakDir > 0 ? '上破' : '下破') + tl.name,
        price: bp,
      });
    }
  });
  events.sort((a, b) => a.i - b.i);

  // 判定最新方向票与状态（严格收盘确认；未收盘 K 线只标 watch 预备）
  let vote = 0;
  let dir = 0;
  let status = 'none';
  let statusLab = '观察';
  let why = '';

  let recentBreak = null;
  picked.concat(filteredLines).forEach((item) => {
    if (item.breakI != null && end - item.breakI <= 2) {
      if (!recentBreak || item.breakI > recentBreak.breakI || (item.breakI === recentBreak.breakI && item.score > recentBreak.score)) {
        recentBreak = item;
      }
    }
  });

  let recentHold = null;
  picked.concat(filteredLines).forEach((item) => {
    if (item.lastRejectI >= 0 && end - item.lastRejectI <= 2 && item.lastRejectDir !== 0) {
      if (!recentHold || item.lastRejectI > recentHold.lastRejectI || (item.lastRejectI === recentHold.lastRejectI && item.score > recentHold.score)) {
        recentHold = item;
      }
    }
  });

  // 也检查最近已收盘一根对支撑/压力的影线收回
  if (!recentHold && nearTest) {
    const asSup = lastClosed.c >= nearTest.price;
    const wickedSup = asSup && lastClosed.l <= nearTest.zoneHi + radius * 0.15 && lastClosed.c >= nearTest.zoneLo;
    const wickedRes = !asSup && lastClosed.h >= nearTest.zoneLo - radius * 0.15 && lastClosed.c <= nearTest.zoneHi;
    if (wickedSup || wickedRes) {
      recentHold = Object.assign({}, nearTest, { lastRejectI: end, lastRejectDir: asSup ? 1 : -1 });
    }
  }

  if (recentBreak) {
    vote = recentBreak.breakDir;
    dir = vote;
    status = 'trigger';
    statusLab = vote > 0 ? '形态上破' : '形态下破';
    why = '收盘' + (vote > 0 ? '突破' : '跌破') + recentBreak.name + (vote > 0 ? '压力 ' : '支撑 ') +
      px(recentBreak.price) + '，破位后自动转换为' + (vote > 0 ? '支撑' : '压力') + '观察。';
  } else if (recentHold) {
    vote = recentHold.lastRejectDir;
    dir = vote;
    status = 'trigger';
    statusLab = vote > 0 ? '形态企稳' : '形态受阻';
    why = '已收盘 K 线回探' + recentHold.name + (vote > 0 ? '支撑带 ' : '压力带 ') +
      px(recentHold.price) + ' 后' + (vote > 0 ? '企稳收回' : '受阻回落') + '。只描述位置，不是下单指令。';
  } else if (hasForming && nearTest) {
    const asSup = last >= nearTest.price;
    const probingSup = asSup && lastBar.l <= nearTest.zoneHi + radius * 0.25;
    const probingRes = !asSup && lastBar.h >= nearTest.zoneLo - radius * 0.25;
    if (probingSup || probingRes) {
      status = 'watch';
      dir = asSup ? 1 : -1;
      statusLab = asSup ? '试探支撑' : '试探压力';
      why = '正在走的 K 线试探' + nearTest.name + (asSup ? '支撑 ' : '压力 ') + px(nearTest.price) + '，收盘后才确认是否企稳或破位。';
    }
  }

  if (!why) {
    if (nearTest) {
      const asSup = last >= nearTest.price;
      status = 'watch';
      statusLab = asSup ? '贴近支撑' : '贴近压力';
      why = '现价贴近' + nearTest.name + (asSup ? '支撑 ' : '压力 ') + px(nearTest.price) + '（' + nearTest.touches + ' 次反应）。';
    } else if (nearSup && nearRes) {
      why = '下方' + nearSup.name + '支撑 ' + px(nearSup.price) + '，上方' + nearRes.name + '压力 ' + px(nearRes.price) + '。';
    } else if (nearSup) {
      why = '下方最近形态支撑为 ' + nearSup.name + ' ' + px(nearSup.price) + '。';
    } else if (nearRes) {
      why = '上方最近形态压力为 ' + nearRes.name + ' ' + px(nearRes.price) + '。';
    } else if (filteredLines.length) {
      const tl = filteredLines[0];
      why = '当前主要斜向参照为' + tl.name + ' ' + px(tl.price) + '。';
    }
  }

  let label = '形态支撑未现';
  if (nearTest) {
    label = (last >= nearTest.price ? '测支撑 ' : '测压力 ') + nearTest.name + ' ' + px(nearTest.price);
  } else if (nearSup && nearRes) {
    label = '支 ' + nearSup.name + ' ' + px(nearSup.price) + ' / 压 ' + nearRes.name + ' ' + px(nearRes.price);
  } else if (nearSup) {
    label = '支 ' + nearSup.name + ' ' + px(nearSup.price);
  } else if (nearRes) {
    label = '压 ' + nearRes.name + ' ' + px(nearRes.price);
  } else if (filteredLines.length) {
    label = filteredLines[0].name + ' ' + px(filteredLines[0].price);
  }

  const sig = [
    'patsr', source, side, end, status, vote,
    nearSup ? nearSup.id + ':' + nearSup.flipCount : '-',
    nearRes ? nearRes.id + ':' + nearRes.flipCount : '-',
    picked.length, filteredLines.length,
  ].join('|');

  return {
    ok: true,
    source: source,
    side: side,
    sig: sig,
    levels: picked,
    trendlines: filteredLines,
    shapes: pickedShapes,
    events: events,
    nearSup: nearSup,
    nearRes: nearRes,
    nearTest: nearTest,
    atrv: atrv,
    radius: radius,
    thresh: thresh,
    vote: vote,
    dir: dir,
    status: status,
    statusLab: statusLab,
    label: label,
    title: label,
    why: why,
  };
}

export function getPatSr(klines) {
  const last = klines && klines[klines.length - 1];
  const src = normalizePatSrSource(state.patSrSource);
  const side = normalizePatSrSide(state.patSrSide);
  const key = [
    klines && klines.length,
    last && last.t, last && last.o, last && last.h, last && last.l, last && last.c,
    state.tf, src, side,
  ].join(':');
  if (state._patSrKey === key && state._patSr) return state._patSr;
  const pack = computePatSr(klines, { source: src, side: side });
  state._patSrKey = key;
  state._patSr = pack;
  return pack;
}
