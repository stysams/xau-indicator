import { pbClosedEnd, stackSrc, tfSpanMs } from '../core/bars.js';
import { n, px } from '../core/format.js';
import { atr, bandArr, bollCore, emaSkipNull, macdOf, rollingHL, rsi, rsiSeries } from '../core/math.js';
import { stackMarkIndex } from './stack.js';
import { mkt, state } from '../state.js';

export function mixPx(a, b, wa) {
  if (a == null) return b;
  if (b == null) return a;
  return wa * a + (1 - wa) * b;
}

export function computeHkldChart(klines) {
  // A21：与 hkldPrep 共用序列与 recAt/hugging/openingAt/wasInside/breakoutAt，避免双份维护
  const prep = hkldPrep(klines, state.tf);
  if (!prep.ok) return hkldNone();
  const n = prep.n;
  const atrv = prep.atrv;
  const closes = prep.closes;
  const recAt = prep.recAt;
  const hugging = prep.hugging;
  const breakoutAt = prep.breakoutAt;
  const end = pbClosedEnd(klines);
  const last = n - 1;
  const evalI = end >= 0 ? end : last;
  const forming = last > evalI;

  function gradeSide(dir, idx, rec, bar, form) {
    const idle = { status: 'idle', loc: [], extra: [] };
    if (!rec || rec.grav == null) return idle;
    const loc = [];
    const extra = [];
    if (dir > 0) {
      if (rec.grav <= 24) loc.push('重心 ' + rec.grav.toFixed(1));
      if (rec.pb != null && rec.pb <= 0.22) loc.push('%B ' + rec.pb.toFixed(2));
      if (rec.longPx != null && (bar.l <= rec.longPx + atrv * 0.12 || (rec.dn != null && bar.l <= rec.dn))) loc.push('贴近下沿');
      if (rec.rsi != null && rec.rsi <= 40) loc.push('RSI ' + rec.rsi.toFixed(1));
      if (rec.gravPrev != null && rec.gravPrev <= 20 && rec.grav > 20) extra.push('重心上穿 20');
      if (rec.gravPrev != null && rec.gravPrev < rec.grav && rec.grav <= 26) extra.push('重心从低位抬头');
      if (rec.dn != null && bar.c >= rec.dn && (
        bar.l < rec.dn ||
        (idx > 0 && klines[idx - 1].l < rec.dn) ||
        (idx > 1 && klines[idx - 2].l < rec.dn)
      )) extra.push('近端收回下轨');
      if (rec.pbPrev != null && rec.pbPrev < 0 && rec.pb != null && rec.pb >= 0) extra.push('%B 收回带内');
      if (rec.rsi != null && rec.rsiPrev != null && rec.rsiPrev <= 34 && rec.rsi > rec.rsiPrev) extra.push('RSI 从超卖抬头');
    } else {
      if (rec.grav >= 76) loc.push('重心 ' + rec.grav.toFixed(1));
      if (rec.pb != null && rec.pb >= 0.78) loc.push('%B ' + rec.pb.toFixed(2));
      if (rec.shortPx != null && (bar.h >= rec.shortPx - atrv * 0.12 || (rec.up != null && bar.h >= rec.up))) loc.push('贴近上沿');
      if (rec.rsi != null && rec.rsi >= 60) loc.push('RSI ' + rec.rsi.toFixed(1));
      if (rec.gravPrev != null && rec.gravPrev >= 80 && rec.grav < 80) extra.push('重心下穿 80');
      if (rec.gravPrev != null && rec.gravPrev > rec.grav && rec.grav >= 74) extra.push('重心从高位回落');
      if (rec.up != null && bar.c <= rec.up && (
        bar.h > rec.up ||
        (idx > 0 && klines[idx - 1].h > rec.up) ||
        (idx > 1 && klines[idx - 2].h > rec.up)
      )) extra.push('近端收回上轨');
      if (rec.pbPrev != null && rec.pbPrev > 1 && rec.pb != null && rec.pb <= 1) extra.push('%B 收回带内');
      if (rec.rsi != null && rec.rsiPrev != null && rec.rsiPrev >= 66 && rec.rsi < rec.rsiPrev) extra.push('RSI 从超买回落');
    }
    const primary = loc.some((s) => s.indexOf('重心') === 0 || s.indexOf('%B') === 0);
    if (!primary || loc.length < 2) return idle;
    if (!extra.length) {
      if (hugging(idx, dir)) return { status: 'block', loc: loc, extra: extra };
      return { status: 'watch', loc: loc, extra: extra };
    }
    return { status: form ? 'watch' : 'trigger', loc: loc, extra: extra };
  }

  function sidePack(dir, idx, rec, bar, form) {
    const g = gradeSide(dir, idx, rec, bar, form);
    return Object.assign({ dir: dir }, g);
  }

  const rec = recAt(evalI);
  const bar = klines[evalI];
  const longG = rec ? sidePack(1, evalI, rec, bar, forming) : { status: 'idle', loc: [], extra: [] };
  const shortG = rec ? sidePack(-1, evalI, rec, bar, forming) : { status: 'idle', loc: [], extra: [] };

  const marks = [];
  let prevDir = 0;
  const scan0 = Math.max(33, n - 48);
  for (let i = scan0; i <= evalI; i++) {
    const r = recAt(i);
    const b = klines[i];
    if (!r || !b) continue;
    const brk = breakoutAt(i);
    const lg = gradeSide(1, i, r, b, false);
    const sg = gradeSide(-1, i, r, b, false);
    let d = 0, lab = '', mkKind = 'fade', mkPx = null, mkY = null;
    if (brk && brk.dir && !brk.continuation && brk.confirmed) {
      d = brk.dir;
      lab = d > 0 ? '上破' : '下破';
      mkKind = 'break';
      mkPx = brk.level;
      mkY = d > 0 ? b.h : b.l;
    } else if (lg.status === 'trigger') {
      d = 1; lab = '低多'; mkPx = r.longPx; mkY = b.l;
    } else if (sg.status === 'trigger') {
      d = -1; lab = '高空'; mkPx = r.shortPx; mkY = b.h;
    }
    if (d && d !== prevDir) {
      marks.push({
        i: i, dir: d, status: 'trigger', kind: mkKind,
        label: lab, px: mkPx, y: mkY,
      });
    }
    prevDir = d;
  }
  if (marks.length > 6) marks.splice(0, marks.length - 6);

  const longPx = rec && rec.longPx;
  const shortPx = rec && rec.shortPx;
  const thin = atrv * 0.2;
  let longLo = rec ? rec.lo : null;
  let longHi = rec ? Math.max(rec.r20, rec.longPx) : null;
  let shortLo = rec ? Math.min(rec.r80, rec.shortPx) : null;
  let shortHi = rec ? rec.hi : null;
  if (longPx != null && longHi != null && longLo != null && longHi - longLo < thin) {
    longLo = longPx - atrv * 0.28;
    longHi = longPx + atrv * 0.12;
  }
  if (shortPx != null && shortHi != null && shortLo != null && shortHi - shortLo < thin) {
    shortLo = shortPx - atrv * 0.12;
    shortHi = shortPx + atrv * 0.28;
  }

  let dir = 0, status = 'idle';
  if (longG.status === 'trigger' && shortG.status !== 'trigger') { dir = 1; status = longG.status; }
  else if (shortG.status === 'trigger' && longG.status !== 'trigger') { dir = -1; status = shortG.status; }
  else if (longG.status === 'watch' && shortG.status !== 'trigger' && shortG.status !== 'watch') { dir = 1; status = 'watch'; }
  else if (shortG.status === 'watch' && longG.status !== 'trigger' && longG.status !== 'watch') { dir = -1; status = 'watch'; }
  else if (longG.status === 'block' && shortG.status === 'idle') { dir = 1; status = 'block'; }
  else if (shortG.status === 'block' && longG.status === 'idle') { dir = -1; status = 'block'; }

  function recentTrig(dirNeed) {
    for (let j = evalI; j >= Math.max(33, evalI - 3); j--) {
      const r = recAt(j);
      const b = klines[j];
      if (!r || !b) continue;
      if (gradeSide(dirNeed, j, r, b, false).status === 'trigger') return true;
    }
    return false;
  }
  if (status === 'watch' && dir > 0 && recentTrig(1)) {
    status = forming ? 'watch' : 'trigger';
    longG.status = status;
  } else if (status === 'watch' && dir < 0 && recentTrig(-1)) {
    status = forming ? 'watch' : 'trigger';
    shortG.status = status;
  }

  let kind = 'fade';
  let breakLevel = null;
  let breakHow = [];
  let br = breakoutAt(evalI);
  if (!br || !br.dir) {
    for (let j = evalI - 1; j >= Math.max(34, evalI - 3); j--) {
      const cand = breakoutAt(j);
      if (!cand || !cand.dir || cand.continuation) continue;
      if (cand.dir > 0 && closes[evalI] >= cand.level) { br = cand; break; }
      if (cand.dir < 0 && closes[evalI] <= cand.level) { br = cand; break; }
    }
  }
  if (br && br.dir && !br.continuation) {
    kind = 'break';
    dir = br.dir;
    breakLevel = br.level;
    breakHow = br.how || [];
    status = (forming || !br.confirmed) ? 'watch' : 'trigger';
    if (dir > 0) {
      shortG.status = status;
      if (longG.status === 'trigger' || longG.status === 'watch') longG.status = 'idle';
    } else {
      longG.status = status;
      if (shortG.status === 'trigger' || shortG.status === 'watch') shortG.status = 'idle';
    }
  }

  const vote = status === 'trigger' ? dir : 0;
  const name = kind === 'break'
    ? (dir > 0
      ? (status === 'trigger' ? '上破反转' : (status === 'watch' ? '上破预备' : '高空低多'))
      : (status === 'trigger' ? '下破反转' : (status === 'watch' ? '下破预备' : '高空低多')))
    : dir > 0
      ? (status === 'trigger' ? '低多推荐' : (status === 'watch' ? '低多预备' : (status === 'block' ? '低多顺势' : '高空低多')))
      : dir < 0
        ? (status === 'trigger' ? '高空推荐' : (status === 'watch' ? '高空预备' : (status === 'block' ? '高空顺势' : '高空低多')))
        : '高空低多';
  const bits = [];
  if (longPx != null) bits.push('低多位置 ' + px(longPx));
  if (shortPx != null) bits.push('高空位置 ' + px(shortPx));
  const gNow = rec && rec.grav != null ? rec.grav.toFixed(1) : '--';
  const pbNow = rec && rec.pb != null ? rec.pb.toFixed(2) : '--';
  const rsiNow = rec && rec.rsi != null ? rec.rsi.toFixed(1) : '--';
  bits.push('重心 ' + gNow);
  bits.push('%B ' + pbNow);
  bits.push('RSI' + (state.rsiN || 14) + ' ' + rsiNow);
  const g = dir > 0 ? longG : (dir < 0 ? shortG : null);
  let why;
  if (!rec) why = '高低区间还没算出来。';
  else if (kind === 'break' && status === 'trigger') {
    why = bits.join('。') + '。' + breakHow.join('，') +
      '。区间被打开，按突破反转看待，不再做' + (dir > 0 ? '高空' : '低多') +
      '。只描述结构，不是下单指令。';
  } else if (kind === 'break' && status === 'watch') {
    why = bits.join('。') + '。' + (breakHow.length ? breakHow.join('，') : '疑似突破') +
      (forming ? '，正在走的那根只预备' : '，突破还差收盘确认') + '。不是下单指令。';
  } else if (status === 'trigger') {
    why = bits.join('。') + '。' +
      (g.extra && g.extra.length ? g.extra.join('，') + '。' : '') +
      '震荡里贴近' + (dir > 0 ? '下沿' : '上沿') + '后出现收回迹象，适合关注' +
      (dir > 0 ? '低多' : '高空') + '。只描述位置，不是下单指令。';
  } else if (status === 'watch') {
    why = bits.join('。') + '。已经靠近' + (dir > 0 ? '低多' : '高空') + '带' +
      (forming ? '，正在走的那根只预备' : '，还差收回或转向确认') + '。不是下单指令。';
  } else if (status === 'block') {
    why = bits.join('。') + '。价格连续贴着' + (dir > 0 ? '下轨' : '上轨') +
      '，还没有收回，单边里不做' + (dir > 0 ? '低多' : '高空') + '。';
  } else {
    why = bits.join('。') + '。价格还在中部，没进推荐带。只描述位置，不是下单指令。';
  }

  return {
    ok: true, vote: vote, dir: dir, status: status,
    name: name, label: name, title: name, why: why, core: vote !== 0,
    i: evalI, fromI: Math.max(0, evalI - 33), forming: forming,
    grav: rec && rec.grav, kin: rec && rec.kin, pb: rec && rec.pb, rsi: rec && rec.rsi,
    longPx: longPx, shortPx: shortPx,
    longLo: longLo, longHi: longHi, shortLo: shortLo, shortHi: shortHi,
    longStatus: longG.status, shortStatus: shortG.status,
    kind: kind, breakLevel: breakLevel, breakHow: breakHow,
    marks: marks, atrv: atrv,
  };
}

export function hkldNone() {
  return {
    ok: false, vote: 0, dir: 0, status: 'none',
    name: '高空低多', label: '样本不足', title: '高空低多',
    why: '高空低多需要至少 34 根 K 线，用来量近期高低位置。',
    core: false, longPx: null, shortPx: null, marks: [],
  };
}

export function hkldClosedEnd(klines, tf) {
  if (!klines || !klines.length) return -1;
  const last = klines[klines.length - 1];
  const span = tfSpanMs(tf || state.tf);
  if (klines.length >= 2 && Date.now() < last.t * 1000 + span - 200) return klines.length - 2;
  return klines.length - 1;
}

export function hkldTfName(tf) {
  if (tf === '15m') return '15分';
  if (tf === '5m') return '5分';
  if (tf === '1m') return '1分';
  if (tf === '1h') return '1小时';
  if (tf === '10s') return '10秒';
  return '本图';
}

export function hkldPrep(klines, tf) {
  if (!klines || klines.length < 34) return { ok: false };
  const n = klines.length;
  const closes = klines.map((k) => k.c);
  const typ = klines.map((k) => (2 * k.c + k.h + k.l) / 4);
  const r21 = rollingHL(klines, 21);
  const r34 = rollingHL(klines, 34);
  const rsvOf = (r) => typ.map((v, i) => {
    if (r.hi[i] == null || r.lo[i] == null) return null;
    const span = r.hi[i] - r.lo[i];
    if (span <= 1e-12) return 50;
    return (v - r.lo[i]) / span * 100;
  });
  const grav = emaSkipNull(rsvOf(r21), 5);
  const kin = emaSkipNull(rsvOf(r34), 8);
  const period = state.bollN || 20;
  const kMul = state.bollK || 2;
  const core = bollCore(closes, period);
  const bands = bandArr(core.mid, core.sd, kMul);
  const md = macdOf(closes);
  const rs = rsiSeries(closes, state.rsiN || 14);
  const atrv = atr(klines, 14) || mkt().atrFloor || 0.4;

  function recAt(idx) {
    if (idx < 0 || r34.lo[idx] == null) return null;
    const lo = r34.lo[idx], hi = r34.hi[idx];
    const span = hi - lo;
    const r20 = lo + 0.20 * span;
    const r80 = lo + 0.80 * span;
    const dn = bands.dn[idx], up = bands.up[idx], mid = core.mid[idx];
    const pb = (up != null && dn != null && up !== dn) ? (closes[idx] - dn) / (up - dn) : null;
    return {
      lo: lo, hi: hi, r20: r20, r80: r80, dn: dn, up: up, mid: mid, pb: pb,
      pbPrev: (idx > 0 && bands.up[idx - 1] != null && bands.dn[idx - 1] != null && bands.up[idx - 1] !== bands.dn[idx - 1])
        ? (closes[idx - 1] - bands.dn[idx - 1]) / (bands.up[idx - 1] - bands.dn[idx - 1]) : null,
      longPx: mixPx(dn, r20, 0.55),
      shortPx: mixPx(up, r80, 0.55),
      grav: grav[idx], kin: kin[idx], rsi: rs[idx],
      hist: md.hist[idx], histPrev: idx > 0 ? md.hist[idx - 1] : null,
      gravPrev: idx > 0 ? grav[idx - 1] : null,
      rsiPrev: idx > 0 ? rs[idx - 1] : null,
    };
  }

  function hugging(idx, dir) {
    let nHit = 0, nOk = 0;
    for (let j = idx - 5; j <= idx; j++) {
      if (j < 0 || bands.up[j] == null || bands.dn[j] == null || bands.up[j] === bands.dn[j]) continue;
      nOk++;
      const pbj = (closes[j] - bands.dn[j]) / (bands.up[j] - bands.dn[j]);
      if (dir < 0 && pbj >= 0.85) nHit++;
      if (dir > 0 && pbj <= 0.15) nHit++;
    }
    return nOk >= 5 && nHit >= 5;
  }

  function openingAt(idx) {
    const i8 = Math.max(period - 1, idx - 8);
    if (bands.up[idx] == null || bands.up[i8] == null || bands.dn[idx] == null || bands.dn[i8] == null) return false;
    return (bands.up[idx] - bands.up[i8] > 0) && (bands.dn[idx] - bands.dn[i8] < 0);
  }

  function wasInside(idx) {
    let inside = 0, nOk = 0;
    for (let j = idx - 8; j <= idx - 2; j++) {
      if (j < 0 || bands.up[j] == null || bands.dn[j] == null || bands.up[j] === bands.dn[j]) continue;
      nOk++;
      const pbj = (closes[j] - bands.dn[j]) / (bands.up[j] - bands.dn[j]);
      if (pbj > 0.18 && pbj < 0.82) inside++;
    }
    return nOk >= 4 && inside >= Math.max(3, nOk * 0.5);
  }

  function breakoutAt(idx) {
    if (idx < 34 || r34.hi[idx - 1] == null || r34.lo[idx - 1] == null) return null;
    const bar = klines[idx];
    const recNow = recAt(idx);
    if (!bar || !recNow) return null;
    const prevHi = r34.hi[idx - 1];
    const prevLo = r34.lo[idx - 1];
    const buf = Math.max(atrv * 0.08, (prevHi - prevLo) * 0.003);
    const closeUp = bar.c > prevHi + buf;
    const closeDn = bar.c < prevLo - buf;
    const bollUp = recNow.up != null && recNow.pb != null && recNow.pb > 1 && recNow.pbPrev != null && recNow.pbPrev <= 1;
    const bollDn = recNow.dn != null && recNow.pb != null && recNow.pb < 0 && recNow.pbPrev != null && recNow.pbPrev >= 0;
    const open = openingAt(idx);
    const histGrowPos = recNow.hist > 0 && recNow.histPrev != null && recNow.hist > recNow.histPrev;
    const histGrowNeg = recNow.hist < 0 && recNow.histPrev != null && recNow.hist < recNow.histPrev;
    let dirBr = 0, level = null, how = [];
    if (closeUp) {
      dirBr = 1; level = prevHi; how.push('收盘越过前高 ' + px(prevHi));
    } else if (closeDn) {
      dirBr = -1; level = prevLo; how.push('收盘跌破前低 ' + px(prevLo));
    } else if (bollUp && (open || histGrowPos)) {
      dirBr = 1; level = recNow.up; how.push('收盘站上上轨');
    } else if (bollDn && (open || histGrowNeg)) {
      dirBr = -1; level = recNow.dn; how.push('收盘跌破下轨');
    }
    if (!dirBr) return null;
    const hug = hugging(idx, dirBr > 0 ? -1 : 1);
    const inside = wasInside(idx);
    const continuation = hug && !inside;
    const beyond = dirBr > 0 ? (bar.c - level) : (level - bar.c);
    const confirmed = open || (dirBr > 0 ? histGrowPos : histGrowNeg) || beyond > atrv * 0.18;
    return {
      dir: dirBr, level: level, how: how,
      continuation: continuation, confirmed: confirmed,
    };
  }

  return {
    ok: true, klines: klines, n: n, atrv: atrv, closes: closes,
    spanSec: Math.floor(tfSpanMs(tf || state.tf) / 1000),
    recAt: recAt, hugging: hugging, breakoutAt: breakoutAt,
  };
}

export function hkldPickIdx(prep, t) {
  const src = prep.klines;
  let i = src.length - 1;
  while (i >= 0 && src[i].t > t) i--;
  // 只用已收盘 HTF K：开盘时间 + 周期跨度 <= 目标时刻，避免前视
  const span = prep.spanSec || 0;
  if (span > 0) {
    while (i >= 0 && src[i].t + span > t) i--;
  }
  return i;
}

export function hkldMixRec(locRec, trigRec, wa) {
  if (!locRec) return null;
  if (!trigRec || wa >= 1) return locRec;
  return {
    lo: locRec.lo, hi: locRec.hi, r20: locRec.r20, r80: locRec.r80,
    dn: mixPx(locRec.dn, trigRec.dn, wa),
    up: mixPx(locRec.up, trigRec.up, wa),
    mid: mixPx(locRec.mid, trigRec.mid, wa),
    pb: mixPx(locRec.pb, trigRec.pb, 0.55),
    longPx: mixPx(locRec.longPx, trigRec.longPx, wa),
    shortPx: mixPx(locRec.shortPx, trigRec.shortPx, wa),
    grav: mixPx(locRec.grav, trigRec.grav, 0.62),
    kin: mixPx(locRec.kin, trigRec.kin, 0.55),
    rsi: trigRec.rsi != null ? trigRec.rsi : locRec.rsi,
    gravPrev: trigRec.gravPrev != null ? trigRec.gravPrev : locRec.gravPrev,
    rsiPrev: trigRec.rsiPrev != null ? trigRec.rsiPrev : locRec.rsiPrev,
    pbPrev: trigRec.pbPrev != null ? trigRec.pbPrev : locRec.pbPrev,
    hist: trigRec.hist, histPrev: trigRec.histPrev,
  };
}

export function gradeHkldHtf(dir, ctx, form) {
  const idle = { status: 'idle', loc: [], extra: [] };
  const locRec = ctx.locRec;
  const trigRec = ctx.trigRec;
  const extraRec = ctx.extraRec || trigRec;
  const extraBar = ctx.extraBar;
  const extraSrc = ctx.extraSrc;
  const extraI = ctx.extraI;
  const chartBar = ctx.chartBar;
  const rec = ctx.rec;
  const locPrep = ctx.locPrep;
  const trigPrep = ctx.trigPrep;
  const locI = ctx.locI;
  const locName = ctx.locName;
  const trigName = ctx.trigName;
  const atrv = ctx.atrv;
  if (!locRec || locRec.grav == null) return idle;
  const loc = [];
  const extra = [];
  const same = locName === trigName;
  const locG = locRec.grav;
  const locPb = locRec.pb;
  const tg = trigRec && trigRec.grav;
  const tpb = trigRec && trigRec.pb;
  const rsi = extraRec && extraRec.rsi != null ? extraRec.rsi : locRec.rsi;
  const rsiPrev = extraRec && extraRec.rsiPrev != null ? extraRec.rsiPrev : locRec.rsiPrev;
  const gravPrev = extraRec && extraRec.gravPrev != null ? extraRec.gravPrev : locRec.gravPrev;
  const gravNow = extraRec && extraRec.grav != null ? extraRec.grav : locRec.grav;
  const pb = extraRec && extraRec.pb != null ? extraRec.pb : locRec.pb;
  const pbPrev = extraRec && extraRec.pbPrev != null ? extraRec.pbPrev : locRec.pbPrev;
  const dn = extraRec && extraRec.dn != null ? extraRec.dn : locRec.dn;
  const up = extraRec && extraRec.up != null ? extraRec.up : locRec.up;
  const bar = extraBar;
  if (dir > 0) {
    if (locG != null && locG <= 28) loc.push(locName + '重心 ' + locG.toFixed(1));
    if (locPb != null && locPb <= 0.26) loc.push(locName + '%B ' + locPb.toFixed(2));
    if (!same && tg != null && tg <= 26) loc.push(trigName + '重心 ' + tg.toFixed(1));
    if (!same && tpb != null && tpb <= 0.24) loc.push(trigName + '%B ' + tpb.toFixed(2));
    if (rec.longPx != null && chartBar && (
      (rec.longHi != null && chartBar.l <= rec.longHi + atrv * 0.12) ||
      chartBar.l <= rec.longPx + atrv * 0.2 ||
      (dn != null && chartBar.l <= dn)
    )) loc.push('贴近低多带');
    if (rsi != null && rsi <= 40) loc.push(trigName + 'RSI ' + rsi.toFixed(1));
    if (gravPrev != null && gravPrev <= 20 && gravNow > 20) extra.push(trigName + '重心上穿 20');
    if (gravPrev != null && gravPrev < gravNow && gravNow <= 26) extra.push(trigName + '重心从低位抬头');
    if (dn != null && bar && bar.c >= dn && (
      bar.l < dn ||
      (extraI > 0 && extraSrc[extraI - 1].l < dn) ||
      (extraI > 1 && extraSrc[extraI - 2].l < dn)
    )) extra.push(trigName + '收回下轨');
    if (pbPrev != null && pbPrev < 0 && pb != null && pb >= 0) extra.push(trigName + '%B 收回带内');
    if (rsi != null && rsiPrev != null && rsiPrev <= 34 && rsi > rsiPrev) extra.push(trigName + 'RSI 从超卖抬头');
  } else {
    if (locG != null && locG >= 72) loc.push(locName + '重心 ' + locG.toFixed(1));
    if (locPb != null && locPb >= 0.74) loc.push(locName + '%B ' + locPb.toFixed(2));
    if (!same && tg != null && tg >= 74) loc.push(trigName + '重心 ' + tg.toFixed(1));
    if (!same && tpb != null && tpb >= 0.76) loc.push(trigName + '%B ' + tpb.toFixed(2));
    if (rec.shortPx != null && chartBar && (
      (rec.shortLo != null && chartBar.h >= rec.shortLo - atrv * 0.12) ||
      chartBar.h >= rec.shortPx - atrv * 0.2 ||
      (up != null && chartBar.h >= up)
    )) loc.push('贴近高空带');
    if (rsi != null && rsi >= 60) loc.push(trigName + 'RSI ' + rsi.toFixed(1));
    if (gravPrev != null && gravPrev >= 80 && gravNow < 80) extra.push(trigName + '重心下穿 80');
    if (gravPrev != null && gravPrev > gravNow && gravNow >= 74) extra.push(trigName + '重心从高位回落');
    if (up != null && bar && bar.c <= up && (
      bar.h > up ||
      (extraI > 0 && extraSrc[extraI - 1].h > up) ||
      (extraI > 1 && extraSrc[extraI - 2].h > up)
    )) extra.push(trigName + '收回上轨');
    if (pbPrev != null && pbPrev > 1 && pb != null && pb <= 1) extra.push(trigName + '%B 收回带内');
    if (rsi != null && rsiPrev != null && rsiPrev >= 66 && rsi < rsiPrev) extra.push(trigName + 'RSI 从超买回落');
  }
  const htfExtreme = dir > 0
    ? ((locG != null && locG <= 28) || (locPb != null && locPb <= 0.26))
    : ((locG != null && locG >= 72) || (locPb != null && locPb >= 0.74));
  if (!htfExtreme) return idle;
  const primary = loc.some((s) => s.indexOf('重心') >= 0 || s.indexOf('%B') >= 0);
  if (!primary || loc.length < 2) return idle;
  if (!extra.length) {
    const hugLoc = locPrep.hugging(locI, dir);
    const hugTrig = trigPrep.hugging(extraI, dir);
    if (hugLoc || hugTrig) return { status: 'block', loc: loc, extra: extra };
    return { status: 'watch', loc: loc, extra: extra };
  }
  return { status: form ? 'watch' : 'trigger', loc: loc, extra: extra };
}

export function hkldFinishPack(rec, longG, shortG, kind, dir, status, forming, evalI, fromI, marks, atrv, locName, trigName, src, breakLevel, breakHow) {
  const longPx = rec && rec.longPx;
  const shortPx = rec && rec.shortPx;
  const vote = status === 'trigger' ? dir : 0;
  const name = kind === 'break'
    ? (dir > 0
      ? (status === 'trigger' ? '上破反转' : (status === 'watch' ? '上破预备' : '高空低多'))
      : (status === 'trigger' ? '下破反转' : (status === 'watch' ? '下破预备' : '高空低多')))
    : dir > 0
      ? (status === 'trigger' ? '低多推荐' : (status === 'watch' ? '低多预备' : (status === 'block' ? '低多顺势' : '高空低多')))
      : dir < 0
        ? (status === 'trigger' ? '高空推荐' : (status === 'watch' ? '高空预备' : (status === 'block' ? '高空顺势' : '高空低多')))
        : '高空低多';
  const bits = [];
  if (longPx != null) bits.push('低多位置 ' + px(longPx));
  if (shortPx != null) bits.push('高空位置 ' + px(shortPx));
  if (rec && rec.lo != null && rec.hi != null) bits.push(locName + '区间 ' + px(rec.lo) + '–' + px(rec.hi));
  const gNow = rec && rec.grav != null ? rec.grav.toFixed(1) : '--';
  const pbNow = rec && rec.pb != null ? rec.pb.toFixed(2) : '--';
  const rsiNow = rec && rec.rsi != null ? rec.rsi.toFixed(1) : '--';
  bits.push(locName + '重心 ' + gNow);
  if (trigName && trigName !== locName) bits.push(trigName + '参与细化位置');
  bits.push('%B ' + pbNow);
  bits.push((trigName || locName) + 'RSI' + (state.rsiN || 14) + ' ' + rsiNow);
  const g = dir > 0 ? longG : (dir < 0 ? shortG : null);
  let why;
  if (!rec) why = '高低区间还没算出来。';
  else if (kind === 'break' && status === 'trigger') {
    why = bits.join('。') + '。' + (breakHow || []).join('，') +
      '。' + locName + '区间被打开，按突破反转看待，不再做' + (dir > 0 ? '高空' : '低多') +
      '。只描述结构，不是下单指令。';
  } else if (kind === 'break' && status === 'watch') {
    why = bits.join('。') + '。' + ((breakHow && breakHow.length) ? breakHow.join('，') : '疑似突破') +
      (forming ? '，正在走的那根只预备' : '，突破还差收盘确认') + '。不是下单指令。';
  } else if (status === 'trigger') {
    why = bits.join('。') + '。' +
      (g && g.extra && g.extra.length ? g.extra.join('，') + '。' : '') +
      locName + '已在' + (dir > 0 ? '下沿' : '上沿') + '，' + (trigName || locName) + '出现收回迹象，适合关注' +
      (dir > 0 ? '低多' : '高空') + '。只描述位置，不是下单指令。';
  } else if (status === 'watch') {
    why = bits.join('。') + '。已经靠近' + (dir > 0 ? '低多' : '高空') + '带' +
      (forming ? '，正在走的那根只预备' : '，还差收回或转向确认') + '。不是下单指令。';
  } else if (status === 'block') {
    why = bits.join('。') + '。价格连续贴着' + (dir > 0 ? '下轨' : '上轨') +
      '，还没有收回，单边里不做' + (dir > 0 ? '低多' : '高空') + '。';
  } else {
    why = bits.join('。') + '。' + locName + '还在中部，不用本图近端三四美元的波幅当高低。只描述位置，不是下单指令。';
  }
  return {
    ok: true, vote: vote, dir: dir, status: status,
    name: name, label: name, title: name, why: why, core: vote !== 0,
    i: evalI, fromI: fromI, forming: forming,
    grav: rec && rec.grav, kin: rec && rec.kin, pb: rec && rec.pb, rsi: rec && rec.rsi,
    longPx: longPx, shortPx: shortPx,
    longLo: rec && rec.longLo, longHi: rec && rec.longHi,
    shortLo: rec && rec.shortLo, shortHi: rec && rec.shortHi,
    longStatus: longG.status, shortStatus: shortG.status,
    kind: kind, breakLevel: breakLevel, breakHow: breakHow,
    marks: marks, atrv: atrv, src: src, locName: locName, trigName: trigName,
  };
}

export function computeHkldHtf(chart, src5, src15) {
  const none = hkldNone();
  const locSrc = src15 || src5;
  const locTf = src15 ? '15m' : '5m';
  const trigSrc = src5 || locSrc;
  const trigTf = src5 ? '5m' : locTf;
  const locPrep = hkldPrep(locSrc, locTf);
  if (!locPrep.ok) return none;
  const trigPrep = (trigSrc === locSrc) ? locPrep : hkldPrep(trigSrc, trigTf);
  if (!trigPrep.ok) return none;
  const locName = hkldTfName(locTf);
  const trigName = hkldTfName(trigTf);
  const locLast = locSrc.length - 1;
  const locClosed = hkldClosedEnd(locSrc, locTf);
  const locI = locClosed >= 33 ? locClosed : locLast;
  const trigLast = trigSrc.length - 1;
  const trigClosed = hkldClosedEnd(trigSrc, trigTf);
  const trigI = trigClosed >= 33 ? trigClosed : trigLast;
  const chartLast = chart.length - 1;
  const chartClosed = hkldClosedEnd(chart, state.tf);
  // 只按本图未收盘降级为预备；HTF 评估已用 closed 索引，不能因 HTF 末根未收盘而永久挡票
  const forming = chartClosed >= 0 && chartLast > chartClosed;
  const recLoc = locPrep.recAt(locLast);
  const recTrig = trigPrep.recAt(trigLast);
  const extraRec = trigPrep.recAt(trigI);
  if (!recLoc) return none;
  const wa = (src15 && src5) ? 0.62 : 1;
  const rec = hkldMixRec(recLoc, recTrig, wa);
  const span = (rec.hi != null && rec.lo != null) ? rec.hi - rec.lo : 0;
  const minGap = Math.max(locPrep.atrv * 2.2, span * 0.22);
  if (rec.longPx != null && rec.shortPx != null && rec.shortPx - rec.longPx < minGap && rec.r20 != null && rec.r80 != null) {
    rec.longPx = rec.r20;
    rec.shortPx = rec.r80;
  }
  rec.longLo = rec.lo;
  rec.longHi = rec.r20 != null && rec.longPx != null ? Math.max(rec.r20, rec.longPx) : rec.r20;
  rec.shortLo = rec.r80 != null && rec.shortPx != null ? Math.min(rec.r80, rec.shortPx) : rec.r80;
  rec.shortHi = rec.hi;
  if (recTrig && recTrig.r20 != null && rec.longHi != null) rec.longHi = Math.max(rec.longHi, recTrig.r20);
  if (recTrig && recTrig.r80 != null && rec.shortLo != null) rec.shortLo = Math.min(rec.shortLo, recTrig.r80);
  if (rec.longLo != null && rec.shortHi != null && rec.longHi != null && rec.shortLo != null && rec.longHi > rec.shortLo) {
    const mid = (rec.longLo + rec.shortHi) / 2;
    rec.longHi = Math.min(rec.longHi, mixPx(rec.longPx, mid, 0.72));
    rec.shortLo = Math.max(rec.shortLo, mixPx(rec.shortPx, mid, 0.72));
  }
  const atrv = locPrep.atrv;
  const thin = atrv * 0.2;
  if (rec.longPx != null && rec.longHi != null && rec.longLo != null && rec.longHi - rec.longLo < thin) {
    rec.longLo = rec.longPx - atrv * 0.28;
    rec.longHi = rec.longPx + atrv * 0.12;
  }
  if (rec.shortPx != null && rec.shortHi != null && rec.shortLo != null && rec.shortHi - rec.shortLo < thin) {
    rec.shortLo = rec.shortPx - atrv * 0.12;
    rec.shortHi = rec.shortPx + atrv * 0.28;
  }
  const chartBar = chart[chartLast];
  const extraBar = trigSrc[trigI];
  const ctx = {
    locRec: recLoc, trigRec: recTrig, extraRec: extraRec,
    extraBar: extraBar, extraSrc: trigSrc, extraI: trigI,
    chartBar: chartBar, rec: rec, locPrep: locPrep, trigPrep: trigPrep, locI: locI,
    locName: locName, trigName: trigName, atrv: atrv,
  };
  const longG = gradeHkldHtf(1, ctx, forming);
  const shortG = gradeHkldHtf(-1, ctx, forming);

  const marks = [];
  let prevDir = 0;
  const markEnd = chartClosed >= 0 ? chartClosed : chartLast;
  const scan0 = Math.max(0, markEnd - 48);
  for (let i = scan0; i <= markEnd; i++) {
    const b = chart[i];
    if (!b) continue;
    const li = hkldPickIdx(locPrep, b.t);
    const ti = hkldPickIdx(trigPrep, b.t);
    if (li < 33 || ti < 33) continue;
    const rL = locPrep.recAt(li);
    const rT = trigPrep.recAt(ti);
    if (!rL) continue;
    const recI = hkldMixRec(rL, rT, wa) || rL;
    recI.longHi = recI.r20;
    recI.shortLo = recI.r80;
    const brk = locPrep.breakoutAt(li);
    const sub = {
      locRec: rL, trigRec: rT, extraRec: rT,
      extraBar: trigSrc[ti], extraSrc: trigSrc, extraI: ti,
      chartBar: b, rec: recI, locPrep: locPrep, trigPrep: trigPrep, locI: li,
      locName: locName, trigName: trigName, atrv: atrv,
    };
    const lg = gradeHkldHtf(1, sub, false);
    const sg = gradeHkldHtf(-1, sub, false);
    let d = 0, lab = '', mkKind = 'fade', mkPx = null, mkY = null;
    if (brk && brk.dir && !brk.continuation && brk.confirmed) {
      d = brk.dir;
      lab = d > 0 ? '上破' : '下破';
      mkKind = 'break';
      mkPx = brk.level;
      mkY = d > 0 ? b.h : b.l;
    } else if (lg.status === 'trigger') {
      d = 1; lab = '低多'; mkPx = recI.longPx; mkY = b.l;
    } else if (sg.status === 'trigger') {
      d = -1; lab = '高空'; mkPx = recI.shortPx; mkY = b.h;
    }
    if (d && d !== prevDir) {
      marks.push({
        i: i, dir: d, status: 'trigger', kind: mkKind,
        label: lab, px: mkPx, y: mkY,
      });
    }
    prevDir = d;
  }
  if (marks.length > 6) marks.splice(0, marks.length - 6);

  let dir = 0, status = 'idle';
  if (longG.status === 'trigger' && shortG.status !== 'trigger') { dir = 1; status = longG.status; }
  else if (shortG.status === 'trigger' && longG.status !== 'trigger') { dir = -1; status = shortG.status; }
  else if (longG.status === 'watch' && shortG.status !== 'trigger' && shortG.status !== 'watch') { dir = 1; status = 'watch'; }
  else if (shortG.status === 'watch' && longG.status !== 'trigger' && longG.status !== 'watch') { dir = -1; status = 'watch'; }
  else if (longG.status === 'block' && shortG.status === 'idle') { dir = 1; status = 'block'; }
  else if (shortG.status === 'block' && longG.status === 'idle') { dir = -1; status = 'block'; }

  function recentTrig(dirNeed) {
    for (let j = trigI; j >= Math.max(33, trigI - 3); j--) {
      const rT = trigPrep.recAt(j);
      const li = hkldPickIdx(locPrep, trigSrc[j].t);
      if (li < 33) continue;
      const rL = locPrep.recAt(li);
      if (!rL || !rT) continue;
      const recJ = hkldMixRec(rL, rT, wa) || rL;
      recJ.longHi = recJ.r20;
      recJ.shortLo = recJ.r80;
      const sub = {
        locRec: rL, trigRec: rT, extraRec: rT,
        extraBar: trigSrc[j], extraSrc: trigSrc, extraI: j,
        chartBar: chartBar, rec: recJ, locPrep: locPrep, trigPrep: trigPrep, locI: li,
        locName: locName, trigName: trigName, atrv: atrv,
      };
      if (gradeHkldHtf(dirNeed, sub, false).status === 'trigger') return true;
    }
    return false;
  }
  if (status === 'watch' && dir > 0 && recentTrig(1)) {
    status = forming ? 'watch' : 'trigger';
    longG.status = status;
  } else if (status === 'watch' && dir < 0 && recentTrig(-1)) {
    status = forming ? 'watch' : 'trigger';
    shortG.status = status;
  }

  let kind = 'fade';
  let breakLevel = null;
  let breakHow = [];
  let br = locPrep.breakoutAt(locI);
  if (!br || !br.dir) {
    for (let j = locI - 1; j >= Math.max(34, locI - 3); j--) {
      const cand = locPrep.breakoutAt(j);
      if (!cand || !cand.dir || cand.continuation) continue;
      if (cand.dir > 0 && locSrc[locI].c >= cand.level) { br = cand; break; }
      if (cand.dir < 0 && locSrc[locI].c <= cand.level) { br = cand; break; }
    }
  }
  const locForming = locLast > locClosed && locClosed >= 0;
  if (br && br.dir && !br.continuation) {
    kind = 'break';
    dir = br.dir;
    breakLevel = br.level;
    breakHow = br.how || [];
    status = (forming || locForming || !br.confirmed) ? 'watch' : 'trigger';
    if (dir > 0) {
      shortG.status = status;
      if (longG.status === 'trigger' || longG.status === 'watch') longG.status = 'idle';
    } else {
      longG.status = status;
      if (shortG.status === 'trigger' || shortG.status === 'watch') shortG.status = 'idle';
    }
  }

  const fromT = locSrc[Math.max(0, locLast - 33)].t;
  const fromI = stackMarkIndex(chart, fromT);
  const src = src15 && src5 ? '15m+5m' : (src15 ? '15m' : '5m');
  return hkldFinishPack(
    rec, longG, shortG, kind, dir, status, forming, chartClosed >= 0 ? chartClosed : chartLast,
    fromI, marks, atrv, locName, trigName, src, breakLevel, breakHow
  );
}

export function computeHkld(klines) {
  const m5 = stackSrc('5m');
  const m15 = stackSrc('15m');
  const has5 = !!(m5 && m5.length >= 34);
  const has15 = !!(m15 && m15.length >= 34);
  if ((has5 || has15) && klines && klines.length >= 2) {
    return computeHkldHtf(klines, has5 ? m5 : null, has15 ? m15 : null);
  }
  return computeHkldChart(klines);
}

export function getHkld(klines) {
  const last = klines && klines[klines.length - 1];
  const m5 = stackSrc('5m');
  const m15 = stackSrc('15m');
  const a = m5 && m5.length ? m5[m5.length - 1] : null;
  const b = m15 && m15.length ? m15[m15.length - 1] : null;
  const key = [
    klines && klines.length, last && last.t, last && last.c, last && last.h, last && last.l,
    state.tf, state.bollN, state.bollK, state.rsiN,
    m5 && m5.length, a && a.t, a && a.c, a && a.h, a && a.l,
    m15 && m15.length, b && b.t, b && b.c, b && b.h, b && b.l,
  ].join(':');
  if (state._hkldKey === key && state._hkld) return state._hkld;
  const pack = computeHkld(klines);
  state._hkldKey = key;
  state._hkld = pack;
  return pack;
}
