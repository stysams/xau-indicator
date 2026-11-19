import { pbClosedEnd } from '../core/bars.js';
import { px } from '../core/format.js';
import { ema } from '../core/math.js';
import { tzParts } from '../core/session.js';
import { mkt, state } from '../state.js';

export const SESSION_PROFILES = {
  asia: { id: 'asia', name: '亚盘', slMult: 1.8, tp1Mult: 1.8, tp2Mult: 3.0 },
  europe: { id: 'europe', name: '欧盘', slMult: 2.0, tp1Mult: 2.2, tp2Mult: 3.6 },
  overlap: { id: 'overlap', name: '欧美重叠', slMult: 2.2, tp1Mult: 2.5, tp2Mult: 4.0 },
  us: { id: 'us', name: '美盘', slMult: 2.0, tp1Mult: 2.2, tp2Mult: 3.5 },
};

export function sessionProfileForTs(tsMs) {
  const t = Number.isFinite(tsMs) ? tsMs : Date.now();
  const bj = tzParts('Asia/Shanghai', new Date(t));
  const h = bj.h;
  if (h >= 6 && h < 15) return SESSION_PROFILES.asia;
  if (h >= 15 && h < 20) return SESSION_PROFILES.europe;
  if (h >= 20 && h < 24) return SESSION_PROFILES.overlap;
  return SESSION_PROFILES.us;
}

export function formatSessionMults(sess) {
  const s = sess || SESSION_PROFILES.asia;
  const f = (v) => (Number.isInteger(v) ? String(v) : String(v));
  return 'SL×' + f(s.slMult) + ' | TP1×' + f(s.tp1Mult) + ' | TP2×' + f(s.tp2Mult);
}

function wilderAtrSeries(klines, period) {
  period = period || 14;
  const n = klines.length;
  const out = new Array(n).fill(null);
  if (n < 2) return out;
  const trs = new Array(n).fill(0);
  trs[0] = Math.max(0, klines[0].h - klines[0].l);
  for (let i = 1; i < n; i++) {
    const c = klines[i];
    const p = klines[i - 1];
    trs[i] = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
  }
  const initLen = Math.min(period, n - 1);
  let sum = 0;
  for (let i = 1; i <= initLen; i++) sum += trs[i];
  let a = sum / Math.max(1, initLen);
  for (let i = 0; i <= initLen; i++) out[i] = a;
  for (let i = initLen + 1; i < n; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    out[i] = a;
  }
  return out;
}

export function computeRangeFilter(closes, period, mult) {
  period = period || 20;
  mult = mult || 2.0;
  const n = closes.length;
  const filt = new Array(n).fill(null);
  const dir = new Array(n).fill(0);
  if (!n) return { filt: filt, dir: dir };

  const diff = new Array(n).fill(0);
  for (let i = 1; i < n; i++) diff[i] = Math.abs(closes[i] - closes[i - 1]);
  const avrng = ema(diff, period);
  const smrng = ema(avrng, Math.max(2, period * 2 - 1)).map((v) => v * mult);

  filt[0] = closes[0];
  let curDir = 0;
  for (let i = 1; i < n; i++) {
    const c = closes[i];
    const r = smrng[i] || 0;
    const prev = filt[i - 1];
    let next = prev;
    if (c > prev) next = Math.max(prev, c - r);
    else if (c < prev) next = Math.min(prev, c + r);
    filt[i] = next;
    if (next > prev) curDir = 1;
    else if (next < prev) curDir = -1;
    dir[i] = curDir;
  }
  return { filt: filt, dir: dir };
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
  };
}

// K线形态识别：返回 { dir, name, code, weight, bars } 或 null
export function detectBarPattern(klines, i, atrArr) {
  if (!klines || i < 2 || i >= klines.length) return null;
  const at = Math.max(Number(atrArr && atrArr[i]) || 0, (mkt && mkt().atrFloor) || 0.4);
  const m0 = candleMetrics(klines[i]);
  const m1 = candleMetrics(klines[i - 1]);
  const m2 = candleMetrics(klines[i - 2]);

  if (m0.range < at * 0.38) return null;

  // 1. 启明星 (Morning Star) / 黄昏之星 (Evening Star) - 3根反转形态
  if (m2.bear && m2.body >= at * 0.55 && m0.bull && m0.body >= at * 0.45) {
    const starSmall = m1.body <= Math.max(m2.body * 0.42, at * 0.35);
    const starLow = m1.hi <= m2.o - m2.body * 0.35 && m1.l <= Math.min(m2.l, m0.l) + at * 0.15;
    const mid2 = (m2.o + m2.c) / 2;
    if (starSmall && starLow && m0.c >= mid2) {
      return { dir: 1, name: '启明星', code: 'morning_star', weight: 3, bars: 3 };
    }
  }
  if (m2.bull && m2.body >= at * 0.55 && m0.bear && m0.body >= at * 0.45) {
    const starSmall = m1.body <= Math.max(m2.body * 0.42, at * 0.35);
    const starHigh = m1.lo >= m2.o + m2.body * 0.35 && m1.h >= Math.max(m2.h, m0.h) - at * 0.15;
    const mid2 = (m2.o + m2.c) / 2;
    if (starSmall && starHigh && m0.c <= mid2) {
      return { dir: -1, name: '黄昏之星', code: 'evening_star', weight: 3, bars: 3 };
    }
  }

  // 2. 红三兵 / 三只乌鸦 - 3根强动能延续形态
  if (m2.bull && m1.bull && m0.bull && m2.c < m1.c && m1.c < m0.c) {
    const bodiesOk = m2.body >= at * 0.35 && m1.body >= at * 0.35 && m0.body >= at * 0.40;
    const wicksOk = m0.upWick <= m0.body * 0.65 && m1.upWick <= m1.body * 0.75;
    if (bodiesOk && wicksOk) {
      return { dir: 1, name: '红三兵', code: 'three_soldiers', weight: 3, bars: 3 };
    }
  }
  if (m2.bear && m1.bear && m0.bear && m2.c > m1.c && m1.c > m0.c) {
    const bodiesOk = m2.body >= at * 0.35 && m1.body >= at * 0.35 && m0.body >= at * 0.40;
    const wicksOk = m0.dnWick <= m0.body * 0.65 && m1.dnWick <= m1.body * 0.75;
    if (bodiesOk && wicksOk) {
      return { dir: -1, name: '三只乌鸦', code: 'three_crows', weight: 3, bars: 3 };
    }
  }

  // 3. 看涨吞没 / 看跌吞没 - 2根强反转形态
  if (m1.bear && m0.bull && m0.body >= at * 0.45 && m0.body > m1.body * 1.08) {
    if (m0.c >= m1.o && m0.o <= m1.c + at * 0.10) {
      return { dir: 1, name: '看涨吞没', code: 'bull_engulf', weight: 2, bars: 2 };
    }
  }
  if (m1.bull && m0.bear && m0.body >= at * 0.45 && m0.body > m1.body * 1.08) {
    if (m0.c <= m1.o && m0.o >= m1.c - at * 0.10) {
      return { dir: -1, name: '看跌吞没', code: 'bear_engulf', weight: 2, bars: 2 };
    }
  }

  // 4. 刺透形态 / 乌云盖顶 - 2根反转形态
  if (m1.bear && m1.body >= at * 0.55 && m0.bull && m0.body >= at * 0.40) {
    const mid1 = (m1.o + m1.c) / 2;
    if (m0.o <= m1.c + at * 0.08 && m0.c > mid1 && m0.c < m1.o) {
      return { dir: 1, name: '刺透形态', code: 'piercing', weight: 2, bars: 2 };
    }
  }
  if (m1.bull && m1.body >= at * 0.55 && m0.bear && m0.body >= at * 0.40) {
    const mid1 = (m1.o + m1.c) / 2;
    if (m0.o >= m1.c - at * 0.08 && m0.c < mid1 && m0.c > m1.o) {
      return { dir: -1, name: '乌云盖顶', code: 'dark_cloud', weight: 2, bars: 2 };
    }
  }

  // 5. 孕线突破 (Inside Bar Breakout) - 3根蓄势破位
  const inside = m1.h <= m2.h + at * 0.04 && m1.l >= m2.l - at * 0.04 && m2.range >= at * 0.6;
  if (inside && m0.body >= at * 0.42) {
    if (m0.bull && m0.c > m2.h) {
      return { dir: 1, name: '孕线上破', code: 'inside_up', weight: 2, bars: 3 };
    }
    if (m0.bear && m0.c < m2.l) {
      return { dir: -1, name: '孕线下破', code: 'inside_dn', weight: 2, bars: 3 };
    }
  }

  // 6. 单根形态：锤子线 (看涨PinBar) / 流星线 (看跌PinBar)
  const lookFrom = Math.max(0, i - 5);
  let recentHi = -Infinity;
  let recentLo = Infinity;
  for (let j = lookFrom; j < i; j++) {
    if (klines[j].h > recentHi) recentHi = klines[j].h;
    if (klines[j].l < recentLo) recentLo = klines[j].l;
  }

  if (m0.range >= at * 0.65) {
    const minBody = Math.max(m0.body, at * 0.10);
    if (m0.dnWick >= minBody * 2.0 && m0.dnWick >= m0.range * 0.56 && m0.upWick <= m0.range * 0.25) {
      if (m0.l <= recentLo + at * 0.18) {
        return { dir: 1, name: '锤子线', code: 'hammer', weight: 1, bars: 1 };
      }
    }
    if (m0.upWick >= minBody * 2.0 && m0.upWick >= m0.range * 0.56 && m0.dnWick <= m0.range * 0.25) {
      if (m0.h >= recentHi - at * 0.18) {
        return { dir: -1, name: '流星线', code: 'shooting_star', weight: 1, bars: 1 };
      }
    }
  }

  return null;
}

function emptyPlan(nowMs, why) {
  const sess = sessionProfileForTs(nowMs);
  return {
    ok: false,
    sig: 'empty',
    trendDir: 0,
    trendLab: '观望',
    session: sess,
    multText: formatSessionMults(sess),
    active: null,
    lastClosed: null,
    forming: null,
    rfDir: 0,
    rfSignal: '等待数据',
    rfFilt: [],
    marks: [],
    pnlPct: null,
    pnlPts: null,
    lastPx: null,
    label: '形态开单 · 样本不足',
    why: why || '至少需要 24 根 K 线计算形态与波动区间。',
  };
}

function buildOrder(klines, i, dir, pattern, atrVal, sess) {
  const k = klines[i];
  const entry = k.c;
  const floor = (mkt && mkt().atrFloor) || 0.4;
  const unit = Math.max(Number(atrVal) || 0, floor);
  const sl = dir > 0 ? entry - unit * sess.slMult : entry + unit * sess.slMult;
  const tp1 = dir > 0 ? entry + unit * sess.tp1Mult : entry - unit * sess.tp1Mult;
  const tp2 = dir > 0 ? entry + unit * sess.tp2Mult : entry - unit * sess.tp2Mult;
  return {
    id: k.t + ':' + dir + ':' + pattern.code,
    i: i,
    t: k.t,
    dir: dir,
    entry: entry,
    sl: sl,
    tp1: tp1,
    tp2: tp2,
    atr: unit,
    pattern: pattern,
    session: sess,
    status: 'open',
    hitTp1: false,
    exitI: -1,
    exitPx: null,
  };
}

export function computePatternPlan(klines, ticker, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!klines || klines.length < 24) return emptyPlan(now);

  const n = klines.length;
  const closes = klines.map((k) => k.c);
  const atrArr = wilderAtrSeries(klines, 14);
  const e9 = ema(closes, 9);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const rf = computeRangeFilter(closes, 20, 2.0);
  const end = Math.max(14, pbClosedEnd(klines));
  const hasForming = end < n - 1;

  // 逐根回放已收盘 K 线，维护信号与当前订单状态，避免未来函数与重绘
  let active = null;
  let lastClosed = null;
  const marks = [];

  for (let i = 15; i <= end; i++) {
    const k = klines[i];
    const at = atrArr[i] || atrArr[i - 1] || 0;
    const rfD = rf.dir[i];
    const prevRfD = rf.dir[i - 1];
    const rfFlipped = rfD !== 0 && prevRfD !== 0 && rfD !== prevRfD;

    // 1. 先检查当前持仓是否触发止损 / TP1 / TP2
    if (active) {
      if (active.dir > 0) {
        if (k.h >= active.tp1) active.hitTp1 = true;
        if (k.l <= active.sl) {
          active.status = 'sl';
          active.exitI = i;
          active.exitPx = active.sl;
          lastClosed = active;
          active = null;
        } else if (k.h >= active.tp2) {
          active.status = 'tp2';
          active.exitI = i;
          active.exitPx = active.tp2;
          lastClosed = active;
          active = null;
        }
      } else {
        if (k.l <= active.tp1) active.hitTp1 = true;
        if (k.h >= active.sl) {
          active.status = 'sl';
          active.exitI = i;
          active.exitPx = active.sl;
          lastClosed = active;
          active = null;
        } else if (k.l <= active.tp2) {
          active.status = 'tp2';
          active.exitI = i;
          active.exitPx = active.tp2;
          lastClosed = active;
          active = null;
        }
      }
    }

    // 2. 检测本根已收盘 K 线的形态信号
    let pat = detectBarPattern(klines, i, atrArr);

    // 若未识别到经典形态，但 RF 方向翻转且当根为强劲实体突破 K 线，也视作形态突破
    if (!pat && rfFlipped) {
      const m0 = candleMetrics(k);
      const effAt = Math.max(at, (mkt && mkt().atrFloor) || 0.4);
      if (m0.range >= effAt * 0.7 && m0.body >= m0.range * 0.6 && ((rfD > 0 && m0.bull) || (rfD < 0 && m0.bear))) {
        pat = {
          dir: rfD,
          name: rfD > 0 ? '强势阳破' : '强势阴破',
          code: rfD > 0 ? 'rf_break_up' : 'rf_break_dn',
          weight: 2,
          bars: 1,
        };
      }
    }

    if (!pat) continue;

    // 3. 结合趋势与 RF 过滤，避免逆势弱形态乱开单
    const alignedRf = rfD === 0 || pat.dir === rfD;
    const onEmaSide = pat.dir > 0 ? k.c >= e9[i] : k.c <= e9[i];
    const qualified = alignedRf || (pat.weight >= 2 && onEmaSide);
    if (!qualified) continue;

    const sess = sessionProfileForTs(k.t * 1000);

    if (!active) {
      active = buildOrder(klines, i, pat.dir, pat, at, sess);
      marks.push({
        i: i,
        t: k.t,
        dir: pat.dir,
        entry: active.entry,
        sl: active.sl,
        tp1: active.tp1,
        tp2: active.tp2,
        pattern: pat,
        session: sess,
      });
    } else if (active.dir !== pat.dir && (pat.weight >= 2 || alignedRf)) {
      // 反向强形态或顺 RF 翻转时平掉旧单并反手开新单
      active.status = 'flip';
      active.exitI = i;
      active.exitPx = k.c;
      lastClosed = active;
      active = buildOrder(klines, i, pat.dir, pat, at, sess);
      marks.push({
        i: i,
        t: k.t,
        dir: pat.dir,
        entry: active.entry,
        sl: active.sl,
        tp1: active.tp1,
        tp2: active.tp2,
        pattern: pat,
        session: sess,
      });
    }
  }

  // 未收盘 K 线只作预备提示，不直接确认开仓
  let forming = null;
  if (hasForming) {
    const fPat = detectBarPattern(klines, n - 1, atrArr);
    if (fPat && (!active || active.dir !== fPat.dir)) {
      forming = fPat;
    }
  }

  // 趋势方向判定（结合 RF 与 EMA20/EMA50）
  const rfDirNow = rf.dir[end] || 0;
  const emaDir = e20[end] > e50[end] ? 1 : (e20[end] < e50[end] ? -1 : 0);
  const cEnd = klines[end].c;
  const fEnd = rf.filt[end];
  let trendDir = 0;
  if (rfDirNow > 0 && (emaDir >= 0 || cEnd >= fEnd)) trendDir = 1;
  else if (rfDirNow < 0 && (emaDir <= 0 || cEnd <= fEnd)) trendDir = -1;
  else if (emaDir !== 0 && ((emaDir > 0 && cEnd > e20[end]) || (emaDir < 0 && cEnd < e20[end]))) trendDir = emaDir;

  const trendLab = trendDir > 0 ? '多头趋势' : (trendDir < 0 ? '空头趋势' : '震荡整理');

  // 最新价格用于计算实时盈亏
  const lastBar = klines[n - 1];
  const livePx = (ticker && Number.isFinite(ticker.last) && ticker.last > 0) ? ticker.last : lastBar.c;

  let pnlPts = null;
  let pnlPct = null;
  if (active && livePx != null && active.entry > 0) {
    pnlPts = active.dir > 0 ? (livePx - active.entry) : (active.entry - livePx);
    pnlPct = (pnlPts / active.entry) * 100;
  }

  // 当前时段：有持仓时展示当前实际时段，同时在时段倍数行反映持仓锁定倍数（无持仓则用当前时段）
  const liveSess = sessionProfileForTs(now);
  const usedSess = active ? active.session : liveSess;
  const multText = formatSessionMults(usedSess);

  // RF / 形态信号状态文案
  let rfSignal = '观望等待';
  if (active) {
    const barsHeld = end - active.i;
    if (barsHeld === 0) rfSignal = active.dir > 0 ? '新触发做多' : '新触发做空';
    else if (active.hitTp1) rfSignal = '已触TP1 · 持有';
    else if (forming && forming.dir !== active.dir) rfSignal = '持有 · 警惕' + forming.name;
    else rfSignal = '持有';
  } else if (forming) {
    rfSignal = '预备 · ' + forming.name;
  } else if (lastClosed && end - lastClosed.exitI <= 2) {
    rfSignal = lastClosed.status === 'tp2' ? '已达TP2止盈' : (lastClosed.status === 'sl' ? '已触发止损' : '已平仓观望');
  }

  const label = active
    ? ((active.dir > 0 ? '多头' : '空头') + ' · ' + active.pattern.name + ' · 开 ' + px(active.entry))
    : (forming ? ('预备' + (forming.dir > 0 ? '多' : '空') + ' · ' + forming.name) : ('形态观望 · ' + trendLab));

  const why = active
    ? (active.pattern.name + '触发' + (active.dir > 0 ? '多单' : '空单') + '，开仓 ' + px(active.entry) +
      '，止损 ' + px(active.sl) + '，TP1 ' + px(active.tp1) + '，TP2 ' + px(active.tp2) + '。')
    : '等待已收盘 K 线出现有效形态后给出开仓与止盈止损点位。';

  const sig = [
    end,
    active ? active.id : 'none',
    active ? (active.hitTp1 ? 1 : 0) : 0,
    forming ? forming.code : 'none',
    trendDir,
    marks.length,
    usedSess.id,
  ].join('|');

  return {
    ok: true,
    sig: sig,
    trendDir: trendDir,
    trendLab: trendLab,
    session: liveSess,
    orderSession: usedSess,
    multText: multText,
    active: active,
    lastClosed: lastClosed,
    forming: forming,
    rfDir: rfDirNow,
    rfSignal: rfSignal,
    rfFilt: rf.filt,
    marks: marks.slice(-12),
    pnlPct: pnlPct,
    pnlPts: pnlPts,
    lastPx: livePx,
    label: label,
    why: why,
  };
}

export function getPatternPlan(klines, ticker) {
  const last = klines && klines[klines.length - 1];
  const live = ticker && Number.isFinite(ticker.last) ? ticker.last : (last && last.c);
  const key = [
    klines && klines.length,
    last && last.t,
    last && last.o,
    last && last.h,
    last && last.l,
    last && last.c,
    live,
    state.tf,
    state.mkt,
  ].join(':');
  if (state._patternKey === key && state._pattern) return state._pattern;
  const pack = computePatternPlan(klines, ticker);
  state._patternKey = key;
  state._pattern = pack;
  return pack;
}
