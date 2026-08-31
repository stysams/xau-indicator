import { atrFallback, n, px } from '../core/format.js';
import { atr, bollCore, pivotPoints, significantPivots } from '../core/math.js';
import { mkt, state } from '../state.js';

export function srPivotK(tf) {
  if (tf === '10s') return 6;
  if (tf === '1m') return 4;
  if (tf === '5m') return 3;
  return 2;
}

export function srMedian(arr) {
  const a = arr.slice().sort(function (x, y) { return x - y; });
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function srCollectPivots(klines, k) {
  return pivotPoints(klines, k);
}

export function srSwingDeviation(last, atrv) {
  return Math.max(atrv * 0.75, last * 0.00030);
}

export function srSignificantPivots(pivots, minMove) {
  return significantPivots(pivots, minMove);
}

export function srCluster(pivots, radius) {
  if (!pivots.length) return [];
  const sorted = pivots.slice().sort(function (a, b) { return a.price - b.price; });
  const groups = [];
  let cur = [sorted[0]];
  let center = sorted[0].price;
  const maxSpread = radius * 1.5;
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i].price;
    const nextCenter = (center * cur.length + p) / (cur.length + 1);
    const spread = p - cur[0].price;
    // 与组中心比较，并对簇宽设 1.5·半径上限，避免单链式无限拉长
    if (Math.abs(p - center) <= radius && spread <= maxSpread) {
      cur.push(sorted[i]);
      center = nextCenter;
    } else {
      groups.push(cur);
      cur = [sorted[i]];
      center = p;
    }
  }
  groups.push(cur);
  return groups.map(function (pts) {
    const prices = pts.map(function (p) { return p.price; });
    const firstI = Math.min.apply(null, pts.map(function (p) { return p.i; }));
    const lastI = Math.max.apply(null, pts.map(function (p) { return p.i; }));
    const hN = pts.filter(function (p) { return p.kind === 'h'; }).length;
    const lN = pts.filter(function (p) { return p.kind === 'l'; }).length;
    const lastPt = pts.reduce(function (a, b) { return a.i > b.i ? a : b; });
    let orig = 'res';
    if (lN > hN) orig = 'sup';
    else if (lN === hN) {
      orig = lastPt.kind === 'l' ? 'sup' : 'res';
    }
    return {
      price: srMedian(prices),
      spread: Math.max.apply(null, prices) - Math.min.apply(null, prices),
      firstI: firstI,
      lastI: lastI,
      pivots: pts,
      hN: hN,
      lN: lN,
      orig: orig,
      lastRole: lastPt.kind === 'l' ? 'sup' : 'res',
      source: 'swing',
      round: false,
    };
  });
}

export function srLevelZone(cluster, radius) {
  const spread = Math.max(0, Number(cluster && cluster.spread) || 0);
  const half = Math.min(radius, Math.max(radius * 0.55, spread * 0.5 + radius * 0.15));
  return {
    half: half,
    lo: cluster.price - half,
    hi: cluster.price + half,
  };
}

export function srTouchMeta(klines, cluster, zone, debounce) {
  const used = {};
  (cluster.pivots || []).forEach(function (p) { used[p.i] = true; });
  let touches = 0;
  let rejections = 0;
  let lastTouch = -99;
  let firstHit = null;
  const gap = debounce == null ? 2 : Math.max(0, debounce);
  const bandLo = zone.lo;
  const bandHi = zone.hi;
  for (let i = 0; i < klines.length; i++) {
    const bar = klines[i];
    if (bar.h < bandLo || bar.l > bandHi) continue;
    const bounceSup = bar.o > bandHi && bar.c > bandHi && bar.l <= bandHi;
    const bounceRes = bar.o < bandLo && bar.c < bandLo && bar.h >= bandLo;
    if (!(bounceSup || bounceRes) && !used[i]) continue;
    if (i - lastTouch <= gap) continue;
    if (firstHit == null) firstHit = i;
    touches += 1;
    if (bounceSup || bounceRes) rejections += 1;
    lastTouch = i;
  }
  return {
    touches: touches,
    rejections: rejections,
    firstI: firstHit == null ? cluster.firstI : firstHit,
    lastI: lastTouch < 0 ? cluster.lastI : lastTouch,
  };
}

export function srBreakMeta(klines, cluster, zone, thresh) {
  const end = Math.max(0, klines.length - 1);
  let role = cluster.lastRole || cluster.orig;
  const events = [];
  for (let i = cluster.lastI + 1; i < end; i++) {
    if (role === 'sup' && klines[i].c < zone.lo - thresh) {
      events.push({ i: i, dir: -1, from: 'sup', to: 'res' });
      role = 'res';
    } else if (role === 'res' && klines[i].c > zone.hi + thresh) {
      events.push({ i: i, dir: 1, from: 'res', to: 'sup' });
      role = 'sup';
    }
  }
  const last = events.length ? events[events.length - 1] : null;
  return {
    breakI: last ? last.i : null,
    breakDir: last ? last.dir : 0,
    role: role,
    flips: events.length,
    events: events,
  };
}

export function srFindBreak(klines, cluster, zone, thresh) {
  return srBreakMeta(klines, cluster, zone, thresh).breakI;
}

export function srBollCandidates(klines, atrv) {
  const out = [];
  if (!klines || klines.length < 22) return out;
  const closes = klines.map(function (x) { return x.c; });
  const core = bollCore(closes, 20);
  const end = klines.length - 1;
  const i0 = Math.max(19, end - 39);
  const lastMid = core.mid[end];
  const lastSd = core.sd[end];
  if (lastMid == null || lastSd == null) return out;
  const last = klines[end].c;
  const bandWidth = Math.max(atrv * 0.28, last * 0.00016);
  const defs = [
    { kind: '下轨', price: lastMid - 2 * lastSd, role: 'sup' },
    { kind: '中轨', price: lastMid, role: last >= lastMid ? 'sup' : 'res' },
    { kind: '上轨', price: lastMid + 2 * lastSd, role: 'res' },
  ];
  defs.forEach(function (def) {
    if (!(def.price > 0) || !Number.isFinite(def.price)) return;
    let touches = 0;
    let firstI = end;
    let lastI = end;
    for (let i = i0; i <= end; i++) {
      if (core.mid[i] == null || core.sd[i] == null) continue;
      const level = def.kind === '下轨'
        ? core.mid[i] - 2 * core.sd[i]
        : (def.kind === '上轨' ? core.mid[i] + 2 * core.sd[i] : core.mid[i]);
      const tol = Math.max(atrv * 0.24, Math.abs(level) * 0.00014);
      const bar = klines[i];
      const hit = def.kind === '下轨'
        ? bar.l <= level + tol
        : (def.kind === '上轨' ? bar.h >= level - tol : bar.l <= level + tol && bar.h >= level - tol);
      if (!hit) continue;
      if (i - lastI <= 2 && touches) continue;
      touches += 1;
      firstI = Math.min(firstI, i);
      lastI = i;
    }
    out.push({
      price: def.price,
      spread: bandWidth,
      firstI: firstI,
      lastI: lastI,
      pivots: [],
      hN: def.role === 'res' ? 1 : 0,
      lN: def.role === 'sup' ? 1 : 0,
      orig: def.role,
      source: 'boll20',
      bollKind: def.kind,
      round: false,
      touches: Math.max(1, touches),
    });
  });
  return out;
}

export function srWaveRange(klines, pivots, k, minMove) {
  if (!klines || !klines.length) return null;
  const count = klines.length;
  const recent = srSignificantPivots((pivots || []).filter(function (p) {
    return p && p.i >= 0 && p.i < count;
  }), minMove);
  if (!recent.length) return null;

  const anchor = recent[recent.length - 1];
  const age = count - 1 - anchor.i;
  const fresh = age <= Math.max(48, Math.round(count * 0.45));
  const dir = anchor.kind === 'l' ? 1 : -1;
  let projected = anchor.price;
  let projectedI = anchor.i;
  let invalidated = false;
  for (let i = anchor.i + 1; i < count; i++) {
    if (dir > 0) {
      if (klines[i].l < anchor.price) invalidated = true;
      if (klines[i].h >= projected) { projected = klines[i].h; projectedI = i; }
    } else {
      if (klines[i].h > anchor.price) invalidated = true;
      if (klines[i].l <= projected) { projected = klines[i].l; projectedI = i; }
    }
  }

  const move = Math.abs(projected - anchor.price);
  if (fresh && !invalidated && move >= minMove) {
    const hi = dir > 0 ? projected : anchor.price;
    const lo = dir > 0 ? anchor.price : projected;
    const hiI = dir > 0 ? projectedI : anchor.i;
    const loI = dir > 0 ? anchor.i : projectedI;
    return {
      hi: hi, lo: lo, mid: (hi + lo) / 2,
      hiI: hiI, loI: loI,
      hiConfirmed: dir < 0, loConfirmed: dir > 0,
      startI: anchor.i, endI: projectedI, dir: dir,
      status: 'forming', source: 'trend-wave', range: hi - lo,
      minMove: minMove,
      label: (dir > 0 ? '上涨波段 ' : '下跌波段 ') + px(lo) + '–' + px(hi) + ' · 终点进行中',
    };
  }

  if (recent.length < 2) return null;
  const from = recent[recent.length - 2];
  const to = recent[recent.length - 1];
  const completedDir = to.kind === 'h' ? 1 : -1;
  const hiPoint = from.kind === 'h' ? from : to;
  const loPoint = from.kind === 'l' ? from : to;
  const hi = hiPoint.price;
  const lo = loPoint.price;
  if (!(hi > lo)) return null;
  return {
    hi: hi, lo: lo, mid: (hi + lo) / 2,
    hiI: hiPoint.i, loI: loPoint.i,
    hiConfirmed: true, loConfirmed: true,
    startI: from.i, endI: to.i, dir: completedDir,
    status: 'confirmed', source: 'trend-wave', range: hi - lo,
    minMove: minMove,
    label: (completedDir > 0 ? '最近上涨波段 ' : '最近下跌波段 ') + px(lo) + '–' + px(hi) + ' · 已确认',
  };
}

export function srMergeLevel(levels, price, radius, patch) {
  for (let i = 0; i < levels.length; i++) {
    if (Math.abs(levels[i].price - price) <= radius) {
      if (patch) patch(levels[i]);
      return levels[i];
    }
  }
  return null;
}

export function srTitle(lv, lastPx) {
  if (!lv) return '';
  if (lv.session) return lv.session + ' ' + px(lv.price);
  if (lv.source === 'boll20' || lv.boll20) return 'BOLL20' + (lv.bollKind ? lv.bollKind : '') + ' ' + px(lv.price);
  const flipped = lv.flipCount > 0 ? '转换' : '';
  if (lv.role === 'test') return (lastPx >= lv.price ? '测试' + flipped + '支撑 ' : '测试' + flipped + '压力 ') + px(lv.price);
  if (lv.role === 'sup') return flipped + '支撑 ' + px(lv.price);
  if (lv.role === 'res') return flipped + '压力 ' + px(lv.price);
  return px(lv.price);
}

export function computeSr(klines) {
  const empty = {
    levels: [], nearSup: null, nearRes: null, nearTest: null,
    atrv: 0, radius: 0, label: '支压未现', vote: 0,
    swing: null,
    why: '摆动点还不够，或还没有聚成可靠的支撑压力。',
  };
  if (!klines || klines.length < 16) return empty;
  const n = klines.length;
  const lastBar = klines[n - 1];
  const last = lastBar.c;
  const atrv = atr(klines, 14) || atrFallback(last);
  const radius = Math.max(atrv * 0.38, last * 0.00022);
  const thresh = Math.max(atrv * 0.22, last * 0.00015);
  const k = srPivotK(state.tf);
  const pivots = srCollectPivots(klines, k);
  const swingMinMove = srSwingDeviation(last, atrv);
  const swing = srWaveRange(klines, pivots, k, swingMinMove);
  const levels = srCluster(pivots, radius);
  // BOLL 轨不再并入静态支压：触碰/强度/破位逻辑与移动轨道量纲不可比
  const bollBands = srBollCandidates(klines, atrv);
  let visHi = -Infinity, visLo = Infinity;
  for (let i = 0; i < n; i++) {
    visHi = Math.max(visHi, klines[i].h);
    visLo = Math.min(visLo, klines[i].l);
  }

  const tf = state.tf;
  const standStep = mkt().roundStand[tf] || mkt().roundStand.default;
  const mergeStep = mkt().roundMerge;
  function addRound(step, standAlone) {
    const below = Math.floor(last / step) * step;
    const above = below + step;
    [below, above].forEach(function (p) {
      if (!(p > 0) || Math.abs(p - last) > atrv * 2.4) return;
      const hit = srMergeLevel(levels, p, radius, function (lv) { lv.round = true; });
      if (hit || !standAlone) return;
      levels.push({
        price: p, spread: 0,
        firstI: Math.max(0, n - Math.round(n * 0.55)), lastI: n - 1,
        pivots: [], hN: 0, lN: 0,
        orig: p > last ? 'res' : 'sup',
        source: 'round', round: true,
      });
    });
  }
  addRound(mergeStep, false);
  addRound(standStep, true);

  const ticker = state.ticker;
  function addSession(price, name) {
    if (price == null || !Number.isFinite(price)) return;
    if (Math.abs(price - last) > atrv * 3.2) return;
    const hit = srMergeLevel(levels, price, radius, function (lv) { lv.session = name; });
    if (hit) return;
    levels.push({
      price: price, spread: 0, firstI: 0, lastI: n - 1,
      pivots: [], hN: 0, lN: 0,
      orig: price > last ? 'res' : 'sup',
      source: name, round: false, session: name,
    });
  }
  // 永续没有真正的今开/昨收会话位，24h 滚动价不进支压
  if (ticker && mkt().hasSession) {
    addSession(ticker.prev, '昨收');
    addSession(ticker.open, '今开');
  }

  const nearBand = Math.max(radius, atrv * 0.42);
  const keep = [];
  levels.forEach(function (lv) {
    const zone = srLevelZone(lv, radius);
    const meta = srTouchMeta(klines, lv, zone, Math.max(2, Math.floor(k / 2)));
    const isBoll20 = lv.source === 'boll20' || lv.boll20;
    lv.touches = isBoll20 ? Math.max(lv.touches || 0, meta.touches) : meta.touches;
    lv.rejections = meta.rejections;
    lv.firstI = isBoll20 ? Math.min(lv.firstI == null ? meta.firstI : lv.firstI, meta.firstI) : meta.firstI;
    lv.lastTouchI = meta.lastI;
    lv.zoneLo = zone.lo;
    lv.zoneHi = zone.hi;
    lv.zoneHalf = zone.half;
    const breakMeta = srBreakMeta(klines, lv, zone, thresh);
    lv.breakI = breakMeta.breakI;
    lv.breakDir = breakMeta.breakDir;
    lv.flipCount = breakMeta.flips;
    lv.structRole = breakMeta.role;
    const age = n - 1 - lv.lastTouchI;
    const recent = age <= Math.max(16, Math.round(n * 0.22));
    const extreme = (lv.hN && lv.zoneHi >= visHi - radius) || (lv.lN && lv.zoneLo <= visLo + radius);
    const special = lv.source === 'round' || !!lv.session;
    if (lv.touches < 2 && !special && !(recent && extreme)) return;
    if (lv.source === 'round' && lv.touches < 2 && Math.abs(last - lv.price) > atrv * 1.2) return;
    if (lv.breakI != null && (n - 1 - lv.breakI) > Math.max(48, Math.round(n * 0.35))) {
      const retested = lv.touches >= 3 && age <= Math.max(20, Math.round(n * 0.18));
      if (!retested) return;
    }
    const distance = last < lv.zoneLo ? lv.zoneLo - last : (last > lv.zoneHi ? last - lv.zoneHi : 0);
    const close = distance <= nearBand;
    const weakRound = lv.source === 'round' && lv.touches < 2;
    if (close && !weakRound) lv.role = 'test';
    else if (last > lv.zoneHi) lv.role = 'sup';
    else lv.role = 'res';
    const recency = 1.4 * (1 - Math.min(1, age / Math.max(8, n)));
    const distanceScore = 2.2 * (1 - Math.min(1, distance / Math.max(atrv * 3, radius * 4)));
    const srcBonus = lv.source === 'swing' ? (lv.boll20 ? 1.25 : 0.9) : (lv.source === 'boll20' ? 0.75 : (lv.session ? 0.35 : (lv.round ? 0.2 : 0)));
    lv.distance = distance;
    lv.distanceScore = distanceScore;
    lv.score = lv.touches * 1.15 + lv.rejections * 0.25 + recency + distanceScore + (lv.breakI == null ? 1 : 0.35) + srcBonus;
    if (lv.role === 'test') lv.score += 0.8;
    lv.strength = Math.round(Math.min(98, 20 + lv.touches * 6 + lv.rejections * 3 + distanceScore * 8 + ((lv.source === 'boll20' || lv.boll20) ? 8 : 0)));
    keep.push(lv);
  });

  if (!keep.length) return Object.assign({}, empty, { swing: swing });

  function srDist(lv, below) {
    const raw = lv.distance;
    const penalty = lv.source === 'swing' ? 0 : radius * 0.45;
    return raw + penalty;
  }
  function srStrong(lv) {
    return lv && !(lv.source === 'round' && lv.touches < 2);
  }
  const tests = keep.filter(function (lv) { return lv.role === 'test'; }).sort(function (a, b) { return b.score - a.score; });
  const sups = keep.filter(function (lv) { return lv.role === 'sup'; }).sort(function (a, b) {
    const da = srDist(a, true), db = srDist(b, true);
    if (Math.abs(da - db) <= radius) return b.score - a.score;
    return da - db;
  });
  const ress = keep.filter(function (lv) { return lv.role === 'res'; }).sort(function (a, b) {
    const da = srDist(a, false), db = srDist(b, false);
    if (Math.abs(da - db) <= radius) return b.score - a.score;
    return da - db;
  });
  const nearSup = sups.filter(srStrong)[0] || sups[0] || (tests[0] && last >= tests[0].price ? tests[0] : null);
  const nearRes = ress.filter(srStrong)[0] || ress[0] || (tests[0] && last < tests[0].price ? tests[0] : null);
  const nearTest = tests.filter(srStrong)[0] || tests[0] || null;

  const picked = [];
  function pushLv(lv) {
    if (!lv) return;
    for (let i = 0; i < picked.length; i++) {
      if (Math.abs(picked[i].price - lv.price) <= radius) {
        if (lv.score > picked[i].score) picked[i] = lv;
        return;
      }
    }
    picked.push(lv);
  }
  pushLv(nearTest);
  pushLv(nearSup);
  pushLv(nearRes);
  const rest = keep.filter(function (lv) { return picked.indexOf(lv) < 0; }).sort(function (a, b) { return b.score - a.score; });
  for (let i = 0; i < rest.length && picked.length < 10; i++) {
    const lv = rest[i];
    const nSup = picked.filter(function (p) { return p.role === 'sup'; }).length;
    const nRes = picked.filter(function (p) { return p.role === 'res'; }).length;
    if (lv.role === 'sup' && nSup >= 5) continue;
    if (lv.role === 'res' && nRes >= 5) continue;
    pushLv(lv);
  }
  picked.sort(function (a, b) { return b.price - a.price; });

  let vote = 0;
  let why = '';
  const bar = klines[n - 1];
  let recentBreak = null;
  keep.forEach(function (lv) {
    if (lv.breakI != null && n - 1 - lv.breakI <= 3) {
      if (!recentBreak || lv.breakI > recentBreak.breakI) recentBreak = lv;
    }
  });
  if (recentBreak) {
    vote = recentBreak.breakDir;
    why = (recentBreak.breakDir < 0 ? '收盘跌破支撑区域 ' : '收盘升破压力区域 ') +
      px(recentBreak.price) +
      '。破位后该区域改当' + (recentBreak.breakDir < 0 ? '压力' : '支撑') + '观察。';
  } else if (nearTest) {
    const asSup = last >= nearTest.price;
    const wickHold = asSup
      ? (bar.l <= nearTest.price + radius && bar.c > nearTest.price + thresh * 0.25)
      : (bar.h >= nearTest.price - radius && bar.c < nearTest.price - thresh * 0.25);
    if (wickHold) {
      vote = asSup ? 1 : -1;
      why = (asSup ? '近端下影线碰到支撑 ' : '近端上影线碰到压力 ') +
        px(nearTest.price) + ' 后收回。只描述位置，不是下单指令。';
    } else {
      why = '现价贴着' + (asSup ? '支撑 ' : '压力 ') + px(nearTest.price) +
        '（' + nearTest.touches + ' 次触碰），观察是否守住或受阻。';
    }
  } else if (nearSup && nearRes) {
    why = '现价夹在支撑 ' + px(nearSup.price) + ' 与压力 ' + px(nearRes.price) + ' 之间。';
  } else if (nearSup) {
    why = '现价在支撑 ' + px(nearSup.price) + ' 上方。';
  } else if (nearRes) {
    why = '现价在压力 ' + px(nearRes.price) + ' 下方。';
  } else {
    why = empty.why;
  }

  let label = '支压未现';
  if (nearTest) label = (last >= nearTest.price ? '测试支撑 ' : '测试压力 ') + px(nearTest.price);
  else if (nearSup && nearRes) label = '支撑 ' + px(nearSup.price) + ' / 压力 ' + px(nearRes.price);
  else if (nearSup) label = '支撑 ' + px(nearSup.price);
  else if (nearRes) label = '压力 ' + px(nearRes.price);

  return {
    levels: picked,
    bands: bollBands,
    swing: swing,
    nearSup: nearSup,
    nearRes: nearRes,
    nearTest: nearTest,
    atrv: atrv,
    radius: radius,
    label: label,
    vote: vote,
    why: why || empty.why,
  };
}

export function getSr(klines) {
  const last = klines[klines.length - 1];
  const t = state.ticker;
  const key = [klines.length, last && last.t, last && last.c, last && last.h, last && last.l, state.tf, t && t.prev, t && t.open].join(':');
  if (state._srKey === key && state._sr) return state._sr;
  const pack = computeSr(klines);
  state._srKey = key;
  state._sr = pack;
  return pack;
}
