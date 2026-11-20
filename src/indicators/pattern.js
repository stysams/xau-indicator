import { pbClosedEnd } from '../core/bars.js';
import { px } from '../core/format.js';
import { bollCore, ema, rsiSeries } from '../core/math.js';
import { tzParts } from '../core/session.js';
import { mkt, state } from '../state.js';
import { findXaudzSetups, XAUDZ_MIN_BARS } from './xaudz.js';

export const PATTERN_MODES = ['classic', 'safe', 'strict', 'xaudz'];

export function normalizePatternMode(v) {
  return PATTERN_MODES.indexOf(v) >= 0 ? v : 'classic';
}

export const SESSION_PROFILES = {
  asia: { id: 'asia', name: '亚盘', slMult: 1.8, tp1Mult: 1.8, tp2Mult: 3.0 },
  europe: { id: 'europe', name: '欧盘', slMult: 2.0, tp1Mult: 2.2, tp2Mult: 3.6 },
  overlap: { id: 'overlap', name: '欧美重叠', slMult: 2.2, tp1Mult: 2.5, tp2Mult: 4.0 },
  us: { id: 'us', name: '美盘', slMult: 2.0, tp1Mult: 2.2, tp2Mult: 3.5 },
};

// 稳健档 TP1 触达后移动保本止损的缓冲幅度（ATR 倍数）
export const BE_CUSHION_ATR = 0.15;

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

// Kaufman 趋势效率比 ER(len)：用于稳健档过滤窄幅锯齿震荡
export function efficiencyRatio(closes, i, len) {
  len = len || 14;
  if (!closes || i < len || i >= closes.length) return 0;
  const change = Math.abs(closes[i] - closes[i - len]);
  let vol = 0;
  for (let j = i - len + 1; j <= i; j++) {
    vol += Math.abs(closes[j] - closes[j - 1]);
  }
  return vol > 0 ? change / vol : 0;
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
    closePos: range > 0 ? (k.c - k.l) / range : 0.5,
  };
}

// 经典 K 线形态识别（与 2ec7e90 保持完全一致的经典口径；strict 档附加收盘强度过滤）
export function detectBarPattern(klines, i, atrArr, mode) {
  if (!klines || i < 2 || i >= klines.length) return null;
  const strict = mode === 'strict';
  const at = Math.max(Number(atrArr && atrArr[i]) || 0, (mkt && mkt().atrFloor) || 0.4);
  const m0 = candleMetrics(klines[i]);
  const m1 = candleMetrics(klines[i - 1]);
  const m2 = candleMetrics(klines[i - 2]);

  if (m0.range < at * (strict ? 0.45 : 0.38)) return null;
  if (strict && m0.range > at * 3.0) return null;

  const bullCloseOk = !strict || m0.closePos >= 0.62;
  const bearCloseOk = !strict || m0.closePos <= 0.38;

  // 1. 启明星 (Morning Star) / 黄昏之星 (Evening Star) - 3根反转形态
  if (bullCloseOk && m2.bear && m2.body >= at * 0.55 && m0.bull && m0.body >= at * 0.45) {
    const starSmall = m1.body <= Math.max(m2.body * 0.42, at * 0.35);
    const starLow = m1.hi <= m2.o - m2.body * 0.35 && m1.l <= Math.min(m2.l, m0.l) + at * 0.15;
    const mid2 = (m2.o + m2.c) / 2;
    if (starSmall && starLow && m0.c >= mid2) {
      return { dir: 1, name: '启明星', code: 'morning_star', weight: 3, bars: 3 };
    }
  }
  if (bearCloseOk && m2.bull && m2.body >= at * 0.55 && m0.bear && m0.body >= at * 0.45) {
    const starSmall = m1.body <= Math.max(m2.body * 0.42, at * 0.35);
    const starHigh = m1.lo >= m2.o + m2.body * 0.35 && m1.h >= Math.max(m2.h, m0.h) - at * 0.15;
    const mid2 = (m2.o + m2.c) / 2;
    if (starSmall && starHigh && m0.c <= mid2) {
      return { dir: -1, name: '黄昏之星', code: 'evening_star', weight: 3, bars: 3 };
    }
  }

  // 2. 红三兵 / 三只乌鸦 - 3根强动能延续形态
  if (bullCloseOk && m2.bull && m1.bull && m0.bull && m2.c < m1.c && m1.c < m0.c) {
    const bodiesOk = m2.body >= at * 0.35 && m1.body >= at * 0.35 && m0.body >= at * 0.40;
    const wicksOk = m0.upWick <= m0.body * 0.65 && m1.upWick <= m1.body * 0.75;
    if (bodiesOk && wicksOk) {
      return { dir: 1, name: '红三兵', code: 'three_soldiers', weight: 3, bars: 3 };
    }
  }
  if (bearCloseOk && m2.bear && m1.bear && m0.bear && m2.c > m1.c && m1.c > m0.c) {
    const bodiesOk = m2.body >= at * 0.35 && m1.body >= at * 0.35 && m0.body >= at * 0.40;
    const wicksOk = m0.dnWick <= m0.body * 0.65 && m1.dnWick <= m1.body * 0.75;
    if (bodiesOk && wicksOk) {
      return { dir: -1, name: '三只乌鸦', code: 'three_crows', weight: 3, bars: 3 };
    }
  }

  // 3. 看涨吞没 / 看跌吞没 - 2根强反转形态（保持 1.08 实体倍比，避免假反抽洗单）
  if (bullCloseOk && m1.bear && m0.bull && m0.body >= at * 0.45 && m0.body > m1.body * 1.08) {
    if (m0.c >= m1.o && m0.o <= m1.c + at * 0.10) {
      return { dir: 1, name: '看涨吞没', code: 'bull_engulf', weight: 2, bars: 2 };
    }
  }
  if (bearCloseOk && m1.bull && m0.bear && m0.body >= at * 0.45 && m0.body > m1.body * 1.08) {
    if (m0.c <= m1.o && m0.o >= m1.c - at * 0.10) {
      return { dir: -1, name: '看跌吞没', code: 'bear_engulf', weight: 2, bars: 2 };
    }
  }

  // 4. 刺透形态 / 乌云盖顶 - 2根反转形态
  if (bullCloseOk && m1.bear && m1.body >= at * 0.55 && m0.bull && m0.body >= at * 0.40) {
    const mid1 = (m1.o + m1.c) / 2;
    if (m0.o <= m1.c + at * 0.08 && m0.c > mid1 && m0.c < m1.o) {
      return { dir: 1, name: '刺透形态', code: 'piercing', weight: 2, bars: 2 };
    }
  }
  if (bearCloseOk && m1.bull && m1.body >= at * 0.55 && m0.bear && m0.body >= at * 0.40) {
    const mid1 = (m1.o + m1.c) / 2;
    if (m0.o >= m1.c - at * 0.08 && m0.c < mid1 && m0.c > m1.o) {
      return { dir: -1, name: '乌云盖顶', code: 'dark_cloud', weight: 2, bars: 2 };
    }
  }

  // 5. 孕线突破 (Inside Bar Breakout) - 3根蓄势破位
  const inside = m1.h <= m2.h + at * 0.04 && m1.l >= m2.l - at * 0.04 && m2.range >= at * 0.6;
  if (inside && m0.body >= at * 0.42) {
    if (bullCloseOk && m0.bull && m0.c > m2.h) {
      return { dir: 1, name: '孕线上破', code: 'inside_up', weight: 2, bars: 3 };
    }
    if (bearCloseOk && m0.bear && m0.c < m2.l) {
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
      if (m0.l <= recentLo + at * 0.18 && (!strict || m0.closePos >= 0.65)) {
        return { dir: 1, name: '锤子线', code: 'hammer', weight: 1, bars: 1 };
      }
    }
    if (m0.upWick >= minBody * 2.0 && m0.upWick >= m0.range * 0.56 && m0.dnWick <= m0.range * 0.25) {
      if (m0.h >= recentHi - at * 0.18 && (!strict || m0.closePos <= 0.35)) {
        return { dir: -1, name: '流星线', code: 'shooting_star', weight: 1, bars: 1 };
      }
    }
  }

  return null;
}

// 判断是否撞在「多重受阻压力天花板 / 支撑地板」或布林极端外沿（防追顶/防砸底档与稳健档使用）
export function isBlockedByWall(klines, i, dir, at, boll) {
  if (!klines || i < 4 || !at) return false;
  const k = klines[i];
  if (boll && boll.mid[i] != null && boll.sd[i] > 0) {
    const up = boll.mid[i] + 2 * boll.sd[i];
    const dn = boll.mid[i] - 2 * boll.sd[i];
    const pb = (k.c - dn) / Math.max(1e-9, up - dn);
    if (dir > 0 && pb > 0.92) return true;
    if (dir < 0 && pb < 0.08) return true;
  }
  const from = Math.max(0, i - 40);
  const to = i - 3;
  if (to <= from + 4) return false;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = from; j <= to; j++) {
    if (klines[j].h > hi) hi = klines[j].h;
    if (klines[j].l < lo) lo = klines[j].l;
  }
  if (dir > 0 && k.c <= hi + at * 0.10 && (hi - k.c) < at * 0.90) {
    let touches = 0;
    let lastT = -99;
    for (let j = from; j <= to; j++) {
      if (klines[j].h >= hi - at * 0.45 && j - lastT >= 3) {
        touches++;
        lastT = j;
      }
    }
    if (touches >= 2) return true;
  }
  if (dir < 0 && k.c >= lo - at * 0.10 && (k.c - lo) < at * 0.90) {
    let touches = 0;
    let lastT = -99;
    for (let j = from; j <= to; j++) {
      if (klines[j].l <= lo + at * 0.45 && j - lastT >= 3) {
        touches++;
        lastT = j;
      }
    }
    if (touches >= 2) return true;
  }
  return false;
}

function emptyPlan(nowMs, mode, why) {
  const sess = sessionProfileForTs(nowMs);
  return {
    ok: false,
    mode: mode,
    sig: 'empty:' + mode,
    trendDir: 0,
    trendLab: '观望',
    session: sess,
    orderSession: sess,
    multText: formatSessionMults(sess),
    active: null,
    lastClosed: null,
    forming: null,
    watch: null,
    rfDir: 0,
    rfSignal: '等待数据',
    rfFilt: [],
    er: 0,
    chopFiltered: false,
    marks: [],
    history: [],
    stats: { total: 0, wins: 0, tp1Hits: 0, tp2Hits: 0, losses: 0, winRate: null },
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
  const origSl = dir > 0 ? entry - unit * sess.slMult : entry + unit * sess.slMult;
  const tp1 = dir > 0 ? entry + unit * sess.tp1Mult : entry - unit * sess.tp1Mult;
  const tp2 = dir > 0 ? entry + unit * sess.tp2Mult : entry - unit * sess.tp2Mult;
  return {
    id: k.t + ':' + dir + ':' + pattern.code,
    i: i,
    t: k.t,
    dir: dir,
    entry: entry,
    origSl: origSl,
    sl: origSl,
    tp1: tp1,
    tp2: tp2,
    atr: unit,
    pattern: pattern,
    session: sess,
    status: 'open',
    hitTp1: false,
    hitTp1I: -1,
    breakeven: false,
    exitI: -1,
    exitPx: null,
  };
}

function xaudzClosedEnd(klines, now) {
  const end = (klines?.length || 0) - 1;
  if (end < 0 || (klines[end].t + 60) * 1000 <= now) return end;
  return end - 1;
}

function computeXaudzPlan(klines, ticker, now) {
  const why = '反推版在一分钟 K 线收盘后判断多空。图上的止损、止盈和结果按分钟台行情计算。';
  const pack = emptyPlan(now, 'xaudz', why);
  pack.multText = 'TP1 1R · TP2 2R';
  if (state.mkt !== 'xau' || state.tf !== '1m') {
    pack.label = '仅支持黄金 1 分钟';
    pack.rfSignal = pack.label;
    return pack;
  }

  const end = xaudzClosedEnd(klines, now);
  if (end + 1 < XAUDZ_MIN_BARS) {
    pack.label = '样本不足';
    pack.rfSignal = '需要至少 ' + XAUDZ_MIN_BARS + ' 根已收盘 K 线';
    return pack;
  }

  const setups = findXaudzSetups(klines, end);
  const marks = setups.map((setup) => {
    const t = klines[setup.i].t;
    return {
      ...setup, t,
      id: t + ':' + setup.dir + ':xaudz',
      pattern: { name: 'xaudz 反推版', code: 'xaudz' },
      session: sessionProfileForTs(t * 1000),
    };
  });
  const history = [];
  let active = null;
  for (let j = 0; j < marks.length; j++) {
    const mark = marks[j];
    const next = marks[j + 1];
    const order = { ...mark, origSl: mark.sl, status: 'open', hitTp1: false, hitTp1I: -1 };
    const last = next ? next.i : end;
    for (let i = mark.i + 1; i <= last; i++) {
      const bar = klines[i];
      const stopHit = order.dir > 0 ? bar.l <= order.sl : bar.h >= order.sl;
      if (stopHit) {
        Object.assign(order, { status: 'sl', exitI: i, exitPx: order.sl });
        break;
      }
      const favorable = order.dir > 0 ? bar.h : bar.l;
      if (!order.hitTp1 && order.dir * (favorable - order.tp1) >= 0) {
        order.hitTp1 = true;
        order.hitTp1I = i;
      }
      if (order.dir * (favorable - order.tp2) >= 0) {
        Object.assign(order, { status: 'tp2', exitI: i, exitPx: order.tp2 });
        break;
      }
    }
    // 新信号接管面板。逐根回放时，同一根同时触达止损与目标按止损处理。
    if (order.status === 'open' && next) {
      Object.assign(order, { status: 'flip', exitI: next.i, exitPx: next.entry });
    }
    if (order.status === 'open') active = order;
    else history.push(order);
  }

  const lastClosed = history.at(-1) || null;
  const lastPx = ticker?.last > 0 && Number.isFinite(ticker.last) ? ticker.last : klines.at(-1).c;
  const pnlPts = active ? active.dir * (lastPx - active.entry) : null;
  const wins = history.filter((order) => order.hitTp1).length;
  const label = active
    ? (active.dir > 0 ? '做多' : '做空') + ' · 开 ' + px(active.entry)
    : '等待信号';
  let rfSignal = active?.hitTp1 ? '已触及 TP1' : label;
  if (!active && lastClosed?.exitI === end && lastClosed.status === 'tp2') rfSignal = '已达 TP2 止盈';
  return {
    ...pack,
    ok: true,
    sig: ['xaudz', klines[end].t, active?.id, active?.hitTp1, lastClosed?.status].join('|'),
    label, rfSignal, active, lastClosed, history, pnlPts, lastPx,
    pnlPct: active ? (pnlPts / active.entry) * 100 : null,
    orderSession: active?.session || pack.session,
    marks: marks.slice(-5),
    stats: {
      total: history.length, wins, tp1Hits: wins, losses: history.length - wins,
      tp2Hits: history.filter((order) => order.status === 'tp2').length,
      winRate: history.length ? wins / history.length : null,
    },
  };
}

export function computePatternPlan(klines, ticker, nowMs, modeOverride) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const mode = normalizePatternMode(modeOverride != null ? modeOverride : state.patternMode);
  if (mode === 'xaudz') return computeXaudzPlan(klines, ticker, now);
  if (!klines || klines.length < 24) return emptyPlan(now, mode);

  const n = klines.length;
  const closes = klines.map((k) => k.c);
  const atrArr = wilderAtrSeries(klines, 14);
  const e9 = ema(closes, 9);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const rsi14 = rsiSeries(closes, 14);
  const boll = bollCore(closes, 20);
  const rf = computeRangeFilter(closes, 20, 2.0);
  const end = Math.max(14, pbClosedEnd(klines));
  const hasForming = end < n - 1;
  const floor = (mkt && mkt().atrFloor) || 0.4;
  const isStrict = mode === 'strict';
  const useWall = mode === 'safe' || mode === 'strict';

  let active = null;
  let lastClosed = null;
  let coolUntil = -1;
  const marks = [];
  const history = [];

  for (let i = 15; i <= end; i++) {
    const k = klines[i];
    const at = atrArr[i] || atrArr[i - 1] || 0;
    const effAt = Math.max(at, floor);
    const rfD = rf.dir[i];
    const prevRfD = rf.dir[i - 1];
    const rfFlipped = rfD !== 0 && prevRfD !== 0 && rfD !== prevRfD;

    // 1. 先检查当前持仓是否触发止损 / TP1 / TP2
    if (active) {
      if (active.dir > 0) {
        if (k.l <= active.sl) {
          active.status = (isStrict && active.hitTp1) ? 'be' : 'sl';
          active.exitI = i;
          active.exitPx = active.sl;
          lastClosed = active;
          history.push(active);
          if (isStrict && !active.hitTp1) coolUntil = i + 2;
          active = null;
        } else {
          if (!active.hitTp1 && k.h >= active.tp1) {
            active.hitTp1 = true;
            active.hitTp1I = i;
            if (isStrict) {
              active.breakeven = true;
              active.sl = active.entry - active.atr * BE_CUSHION_ATR;
            }
          }
          if (k.h >= active.tp2) {
            active.status = 'tp2';
            active.exitI = i;
            active.exitPx = active.tp2;
            lastClosed = active;
            history.push(active);
            active = null;
          }
        }
      } else {
        if (k.h >= active.sl) {
          active.status = (isStrict && active.hitTp1) ? 'be' : 'sl';
          active.exitI = i;
          active.exitPx = active.sl;
          lastClosed = active;
          history.push(active);
          if (isStrict && !active.hitTp1) coolUntil = i + 2;
          active = null;
        } else {
          if (!active.hitTp1 && k.l <= active.tp1) {
            active.hitTp1 = true;
            active.hitTp1I = i;
            if (isStrict) {
              active.breakeven = true;
              active.sl = active.entry + active.atr * BE_CUSHION_ATR;
            }
          }
          if (k.l <= active.tp2) {
            active.status = 'tp2';
            active.exitI = i;
            active.exitPx = active.tp2;
            lastClosed = active;
            history.push(active);
            active = null;
          }
        }
      }
    }

    if (isStrict && (active || i <= coolUntil || i < 20)) continue;

    // 2. 检测本根已收盘 K 线的形态信号
    let pat = detectBarPattern(klines, i, atrArr, mode);

    // 经典/防追顶档保留 RF 翻转强实体突破（强势阳破 / 强势阴破）
    if (!pat && !isStrict && rfFlipped) {
      const m0 = candleMetrics(k);
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

    // 3. 过滤条件
    const alignedRf = rfD === 0 || pat.dir === rfD;
    const onEmaSide = pat.dir > 0 ? k.c >= e9[i] : k.c <= e9[i];
    if (useWall && isBlockedByWall(klines, i, pat.dir, effAt, boll)) continue;

    let qualified = false;
    if (!isStrict) {
      // 经典 / 防追顶档：与 2ec7e90 完全一致的波段拐点 + RF 顺势口径
      qualified = alignedRf || (pat.weight >= 2 && onEmaSide);
    } else {
      // 稳健档：严格顺势回踩 + 反震荡效率过滤
      const prev20 = e20[Math.max(0, i - 3)];
      const slopeOk = pat.dir > 0 ? (e20[i] >= prev20) : (e20[i] <= prev20);
      const onE20 = pat.dir > 0 ? k.c > e20[i] : k.c < e20[i];
      const er = efficiencyRatio(closes, i, 14);
      const distE20 = pat.dir > 0 ? (k.c - e20[i]) / effAt : (e20[i] - k.c) / effAt;
      const r = rsi14[i] != null ? rsi14[i] : 50;
      let touched = false;
      for (let j = Math.max(0, i - 2); j <= i; j++) {
        if (pat.dir > 0 && klines[j].l <= Math.max(e9[j], e20[j]) + effAt) touched = true;
        if (pat.dir < 0 && klines[j].h >= Math.min(e9[j], e20[j]) - effAt) touched = true;
      }
      qualified = rfD === pat.dir && slopeOk && onE20 && er >= 0.14 && touched && distE20 <= 2.0 &&
        (pat.dir > 0 ? r <= 72 : r >= 28);
    }

    if (!qualified) continue;

    const sess = sessionProfileForTs(k.t * 1000);
    if (!active) {
      active = buildOrder(klines, i, pat.dir, pat, at, sess);
      marks.push({
        i: i,
        t: k.t,
        dir: pat.dir,
        entry: active.entry,
        sl: active.origSl,
        tp1: active.tp1,
        tp2: active.tp2,
        pattern: pat,
        session: sess,
      });
    } else if (!isStrict && active.dir !== pat.dir && (pat.weight >= 2 || alignedRf)) {
      active.status = 'flip';
      active.exitI = i;
      active.exitPx = k.c;
      lastClosed = active;
      history.push(active);
      active = buildOrder(klines, i, pat.dir, pat, at, sess);
      marks.push({
        i: i,
        t: k.t,
        dir: pat.dir,
        entry: active.entry,
        sl: active.origSl,
        tp1: active.tp1,
        tp2: active.tp2,
        pattern: pat,
        session: sess,
      });
    }
  }

  // 未收盘 K 线只作预备提示，不提前确认开仓
  let forming = null;
  if (hasForming) {
    const fPat = detectBarPattern(klines, n - 1, atrArr, mode);
    if (fPat && (!active || active.dir !== fPat.dir)) {
      forming = fPat;
    }
  }

  // 趋势方向判定（结合 RF 与 EMA20/EMA50）
  const rfDirNow = rf.dir[end] || 0;
  const erNow = efficiencyRatio(closes, end, 14);
  const emaDir = e20[end] > e50[end] ? 1 : (e20[end] < e50[end] ? -1 : 0);
  const cEnd = klines[end].c;
  const fEnd = rf.filt[end];
  const chopFiltered = isStrict && erNow < 0.14;

  let trendDir = 0;
  if (rfDirNow > 0 && (emaDir >= 0 || cEnd >= fEnd)) trendDir = 1;
  else if (rfDirNow < 0 && (emaDir <= 0 || cEnd <= fEnd)) trendDir = -1;
  else if (emaDir !== 0 && ((emaDir > 0 && cEnd > e20[end]) || (emaDir < 0 && cEnd < e20[end]))) trendDir = emaDir;

  const trendLab = trendDir > 0 ? '多头趋势' : (trendDir < 0 ? '空头趋势' : '震荡整理');

  const lastBar = klines[n - 1];
  const livePx = (ticker && Number.isFinite(ticker.last) && ticker.last > 0) ? ticker.last : lastBar.c;
  const liveSess = sessionProfileForTs(now);
  const atEnd = Math.max(atrArr[end] || 0, floor);

  // 空仓时给出参考建议（趋势回踩或压力/支撑反转观察）
  let watch = null;
  if (!active && livePx != null && trendDir !== 0 && !chopFiltered) {
    let wDir = trendDir;
    let wKind = 'trend';
    if (useWall && isBlockedByWall(klines, end, wDir, atEnd, boll)) {
      if (mode === 'safe') { wDir = -wDir; wKind = 'rev'; }
      else wDir = 0;
    }
    if (wDir !== 0) {
      let refEntry = livePx;
      if (wKind === 'trend') {
        const anchor = wDir > 0
          ? Math.min(livePx, Math.max(e20[end], e9[end]))
          : Math.max(livePx, Math.min(e20[end], e9[end]));
        const maxPull = atEnd * 0.85;
        refEntry = wDir > 0 ? Math.max(livePx - maxPull, anchor) : Math.min(livePx + maxPull, anchor);
      }
      watch = {
        dir: wDir,
        kind: wKind,
        entry: refEntry,
        sl: wDir > 0 ? refEntry - atEnd * liveSess.slMult : refEntry + atEnd * liveSess.slMult,
        tp1: wDir > 0 ? refEntry + atEnd * liveSess.tp1Mult : refEntry - atEnd * liveSess.tp1Mult,
        tp2: wDir > 0 ? refEntry + atEnd * liveSess.tp2Mult : refEntry - atEnd * liveSess.tp2Mult,
        session: liveSess,
      };
    }
  }

  let pnlPts = null;
  let pnlPct = null;
  if (active && livePx != null && active.entry > 0) {
    pnlPts = active.dir > 0 ? (livePx - active.entry) : (active.entry - livePx);
    pnlPct = (pnlPts / active.entry) * 100;
  }

  const usedSess = active ? active.session : liveSess;
  const multText = formatSessionMults(usedSess);

  // 窗口内已平仓订单统计（触达 TP1 或平仓盈利均计为胜）
  let wins = 0;
  let tp1Hits = 0;
  let tp2Hits = 0;
  let losses = 0;
  for (let i = 0; i < history.length; i++) {
    const tr = history[i];
    if (tr.hitTp1) tp1Hits++;
    if (tr.status === 'tp2') { tp2Hits++; wins++; }
    else if (tr.status === 'be') wins++;
    else if (tr.status === 'flip') {
      const rem = tr.dir > 0 ? (tr.exitPx - tr.entry) : (tr.entry - tr.exitPx);
      if (tr.hitTp1 || rem > 0) wins++;
      else losses++;
    } else if (tr.hitTp1) {
      // 经典/防追顶档：先触达 TP1 后才回落止损的，分批策略下视为 TP1 达标
      wins++;
    } else {
      losses++;
    }
  }
  const totalClosed = history.length;
  const stats = {
    total: totalClosed,
    wins: wins,
    tp1Hits: tp1Hits,
    tp2Hits: tp2Hits,
    losses: losses,
    winRate: totalClosed > 0 ? (wins / totalClosed) : null,
  };

  let rfSignal = chopFiltered ? '震荡过滤 · 观望' : '观望等待';
  if (active) {
    const barsHeld = end - active.i;
    if (barsHeld === 0) rfSignal = active.dir > 0 ? '新触发做多' : '新触发做空';
    else if (active.hitTp1) rfSignal = active.breakeven ? '已触TP1 · 移动保本' : '已触TP1 · 持有';
    else if (forming && forming.dir !== active.dir) rfSignal = '持有 · 警惕' + forming.name;
    else rfSignal = '持有';
  } else if (forming) {
    rfSignal = '预备 · ' + forming.name;
  } else if (watch) {
    rfSignal = watch.kind === 'rev'
      ? (watch.dir > 0 ? '支撑低多观察' : '压力高空观察')
      : (watch.dir > 0 ? '待回踩均线做多' : '待反抽均线做空');
  } else if (lastClosed && end - lastClosed.exitI <= 2) {
    rfSignal = lastClosed.status === 'tp2'
      ? '已达TP2止盈'
      : (lastClosed.status === 'sl' ? '已触发止损' : '已平仓观望');
  }

  const label = active
    ? ((active.dir > 0 ? '多头' : '空头') + ' · ' + active.pattern.name + ' · 开 ' + px(active.entry))
    : (forming
      ? ('预备' + (forming.dir > 0 ? '多' : '空') + ' · ' + forming.name)
      : (watch ? ((watch.dir > 0 ? '待回踩多' : '待反抽空') + ' · 参考 ' + px(watch.entry)) : ('形态观望 · ' + trendLab)));

  const why = active
    ? (active.pattern.name + '触发' + (active.dir > 0 ? '多单' : '空单') + '，开仓 ' + px(active.entry) +
      '，' + (active.breakeven ? '保本止损 ' : '止损 ') + px(active.sl) +
      '，TP1 ' + px(active.tp1) + '，TP2 ' + px(active.tp2) + '。')
    : '等待已收盘 K 线出现有效形态后给出开仓与止盈止损点位。';

  const sig = [
    mode,
    end,
    active ? active.id : (watch ? ('w:' + watch.dir + ':' + watch.kind) : 'none'),
    active ? (active.hitTp1 ? 1 : 0) : 0,
    forming ? forming.code : 'none',
    trendDir,
    marks.length,
    totalClosed,
    wins,
    usedSess.id,
  ].join('|');

  return {
    ok: true,
    mode: mode,
    sig: sig,
    trendDir: trendDir,
    trendLab: trendLab,
    session: liveSess,
    orderSession: usedSess,
    multText: multText,
    active: active,
    lastClosed: lastClosed,
    forming: forming,
    watch: watch,
    rfDir: rfDirNow,
    rfSignal: rfSignal,
    rfFilt: rf.filt,
    er: erNow,
    chopFiltered: chopFiltered,
    marks: marks.slice(-12),
    history: history,
    stats: stats,
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
  const mode = normalizePatternMode(state.patternMode);
  const now = Date.now();
  const key = [
    mode,
    klines && klines.length,
    last && last.t,
    last && last.o,
    last && last.h,
    last && last.l,
    last && last.c,
    live,
    state.tf,
    state.mkt,
    mode === 'xaudz' ? xaudzClosedEnd(klines, now) : '',
  ].join(':');
  if (state._patternKey === key && state._pattern) return state._pattern;
  const pack = computePatternPlan(klines, ticker, now, mode);
  state._patternKey = key;
  state._pattern = pack;
  return pack;
}
