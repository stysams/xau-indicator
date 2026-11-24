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
  asia: { id: 'asia', name: '亚盘', slMult: 1.5, tp1Mult: 1.5, tp2Mult: 3.45 },
  europe: { id: 'europe', name: '欧盘', slMult: 1.65, tp1Mult: 1.65, tp2Mult: 3.8 },
  overlap: { id: 'overlap', name: '欧美重叠', slMult: 1.8, tp1Mult: 1.8, tp2Mult: 4.15 },
  us: { id: 'us', name: '美盘', slMult: 1.65, tp1Mult: 1.65, tp2Mult: 3.8 },
};

// 3 分钟周期专属盘口倍数：贴合 3m 形态 3~6 根惯性射程，同时严格维持 TP1=1R / TP2≈2.3R 结构
export const SESSION_PROFILES_3M = {
  asia: { id: 'asia', name: '亚盘', slMult: 1.3, tp1Mult: 1.3, tp2Mult: 3.0 },
  europe: { id: 'europe', name: '欧盘', slMult: 1.4, tp1Mult: 1.4, tp2Mult: 3.22 },
  overlap: { id: 'overlap', name: '欧美重叠', slMult: 1.5, tp1Mult: 1.5, tp2Mult: 3.45 },
  us: { id: 'us', name: '美盘', slMult: 1.4, tp1Mult: 1.4, tp2Mult: 3.22 },
};

// TP1 触达后移动保本锁盈的盈利侧缓冲幅度（ATR 倍数，覆盖点差避免回吐）
export const BE_CUSHION_ATR = 0.05;

// 低延迟 Range Filter 参数与双向限幅结构止损（与 TP1 保持 1:1 盈亏比）
const RF_PERIOD = 14;
const RF_MULT = 1.6;
const ANTI_WICK_BUF_ATR = 0.22;
const ANTI_WICK_MAX_EXTRA_ATR = 0.30;
const ANTI_WICK_MAX_EXTRA_ATR_3M = 0.22;
const STRUCT_SL_MIN_RATIO = 0.85;

// 分钟级短周期（1m/3m/5m）高胜率核心形态白名单（流动性扫荡收回 + 极值反转形态 + 5m 布林外轨收回）
const CORE_SHORT_CODES = new Set([
  'sweep_up', 'sweep_dn',
  'bull_engulf', 'bear_engulf',
  'hammer', 'shooting_star',
  'piercing', 'dark_cloud',
  'bb_snap_up', 'bb_snap_dn',
]);
const STRICT_SHORT_CODES = new Set([
  'sweep_up', 'sweep_dn',
  'bull_engulf', 'bear_engulf',
  'hammer', 'shooting_star',
  'bb_snap_up', 'bb_snap_dn',
]);
const STRICT_3M_ER_MIN = 0.16;
const SHORT_TFS = new Set(['1m', '3m', '5m']);

export function sessionProfileForTs(tsMs, tf) {
  const t = Number.isFinite(tsMs) ? tsMs : Date.now();
  const bj = tzParts('Asia/Shanghai', new Date(t));
  const h = bj.h;
  const table = tf === '3m' ? SESSION_PROFILES_3M : SESSION_PROFILES;
  if (h >= 6 && h < 15) return table.asia;
  if (h >= 15 && h < 20) return table.europe;
  if (h >= 20 && h < 24) return table.overlap;
  return table.us;
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

// 3 分钟高胜率流动性扫荡收回识别：刺破前 N 根极值后长影线快速收回，1 根 K 线直接确认
export function detectSweepPattern(klines, i, atrArr, lookback) {
  const lb = lookback || 8;
  if (!klines || i < lb || i >= klines.length) return null;
  const at = Math.max(Number(atrArr && atrArr[i]) || 0, (mkt && mkt().atrFloor) || 0.4);
  const m0 = candleMetrics(klines[i]);
  if (m0.range < at * 0.48 || m0.range > at * 2.8) return null;

  let prevHi = -Infinity;
  let prevLo = Infinity;
  for (let j = i - lb; j < i; j++) {
    if (klines[j].h > prevHi) prevHi = klines[j].h;
    if (klines[j].l < prevLo) prevLo = klines[j].l;
  }

  if (m0.l < prevLo - at * 0.04 && m0.c > prevLo + at * 0.04 && m0.dnWick >= m0.range * 0.35 && m0.closePos >= 0.58) {
    return { dir: 1, name: '扫低收回', code: 'sweep_up', weight: 3, bars: 1 };
  }
  if (m0.h > prevHi + at * 0.04 && m0.c < prevHi - at * 0.04 && m0.upWick >= m0.range * 0.35 && (1 - m0.closePos) >= 0.58) {
    return { dir: -1, name: '扫高收回', code: 'sweep_dn', weight: 3, bars: 1 };
  }
  return null;
}

// 低延迟单棒形态：流动性扫荡收回（专吃假突破插针）与顺势均线回踩拒收
export function detectLowLatencyPattern(klines, i, atrArr, e9, e20) {
  if (!klines || i < 6 || i >= klines.length) return null;
  const at = Math.max(Number(atrArr && atrArr[i]) || 0, (mkt && mkt().atrFloor) || 0.4);
  const m0 = candleMetrics(klines[i]);
  if (m0.range < at * 0.50 || m0.range > at * 3.0) return null;

  let prevHi = -Infinity;
  let prevLo = Infinity;
  for (let j = i - 6; j < i; j++) {
    if (klines[j].h > prevHi) prevHi = klines[j].h;
    if (klines[j].l < prevLo) prevLo = klines[j].l;
  }

  // 1. 流动性扫荡收回（Liquidity Sweep Reversal）：刺破前6根极值后长影收回，1根K线极速确认
  if (m0.l < prevLo - at * 0.05 && m0.c > prevLo + at * 0.05 && m0.dnWick >= m0.range * 0.38 && m0.closePos >= 0.60) {
    return { dir: 1, name: '扫低收回', code: 'sweep_up', weight: 3, bars: 1 };
  }
  if (m0.h > prevHi + at * 0.05 && m0.c < prevHi - at * 0.05 && m0.upWick >= m0.range * 0.38 && m0.closePos <= 0.40) {
    return { dir: -1, name: '扫高收回', code: 'sweep_dn', weight: 3, bars: 1 };
  }

  // 2. 顺势均线回踩拒收（EMA Pullback Rejection）：比等2根吞没或3根星线早1~2根确认
  if (e9 && e20 && e9[i] != null && e20[i] != null && e20[i - 3] != null) {
    const bullTrend = e9[i] > e20[i] && e20[i] > e20[i - 3];
    const bearTrend = e9[i] < e20[i] && e20[i] < e20[i - 3];
    if (bullTrend && m0.bull && m0.l <= e9[i] + at * 0.10 && m0.c > e9[i] &&
        m0.dnWick >= m0.range * 0.40 && m0.closePos >= 0.68 && m0.body >= at * 0.25) {
      return { dir: 1, name: '回踩拒跌', code: 'pb_reject_up', weight: 2, bars: 1 };
    }
    if (bearTrend && m0.bear && m0.h >= e9[i] - at * 0.10 && m0.c < e9[i] &&
        m0.upWick >= m0.range * 0.40 && m0.closePos <= 0.32 && m0.body >= at * 0.25) {
      return { dir: -1, name: '反抽拒涨', code: 'pb_reject_dn', weight: 2, bars: 1 };
    }
  }

  return null;
}

// 布林 ±2.0σ 外轨刺破强收回识别（专抓 5m 等短周期超伸均值回归）
export function detectBbSnapPattern(klines, i, at, boll) {
  if (!klines || i < 2 || i >= klines.length || !at || !boll || boll.mid[i] == null || !(boll.sd[i] > 0)) return null;
  const k = klines[i];
  const m0 = candleMetrics(k);
  const rangeAtr = m0.range / at;
  if (rangeAtr < 0.45 || rangeAtr > 2.2) return null;
  const z = (k.c - boll.mid[i]) / boll.sd[i];
  const zLo = (k.l - boll.mid[i]) / boll.sd[i];
  const zHi = (k.h - boll.mid[i]) / boll.sd[i];
  if (zLo <= -2.0 && z <= -0.40 && m0.closePos >= 0.58 && (m0.bull || m0.dnWick >= m0.range * 0.45)) {
    return { dir: 1, name: '布林下轨收回', code: 'bb_snap_up', weight: 3, bars: 1 };
  }
  if (zHi >= 2.0 && z >= 0.40 && m0.closePos <= 0.42 && (m0.bear || m0.upWick >= m0.range * 0.45)) {
    return { dir: -1, name: '布林上轨收回', code: 'bb_snap_dn', weight: 3, bars: 1 };
  }
  return null;
}

// 计算当前收盘在近 lookback 根波段区间中的相对位置（按交易方向归一化：0=低吸起爆位，1=顶部追高位）
export function rangePosInDir(klines, i, dir, at, lookback) {
  const lb = lookback || 24;
  if (!klines || i < 2 || !at) return 0.5;
  let rHi = -Infinity;
  let rLo = Infinity;
  const from = Math.max(0, i - lb);
  for (let j = from; j <= i; j++) {
    if (klines[j].h > rHi) rHi = klines[j].h;
    if (klines[j].l < rLo) rLo = klines[j].l;
  }
  const span = rHi - rLo;
  if (span < at * 1.8) return 0.5;
  const c = klines[i].c;
  return dir > 0 ? (c - rLo) / span : (rHi - c) / span;
}

// 统一防追顶/防砸底判定：多重墙体（不因顺 EMA50 旁路）+ 波段高位/低位区间分位 + 布林超伸
export function isChasingExtreme(klines, i, dir, at, boll, opts) {
  if (!klines || i < 4 || !at) return false;
  if (isBlockedByWall(klines, i, dir, at, boll)) return true;
  const cfg = opts || {};
  const maxPos = cfg.maxPos != null ? cfg.maxPos : 0.82;
  const maxZ = cfg.maxZ != null ? cfg.maxZ : 1.8;
  const pos = rangePosInDir(klines, i, dir, at, cfg.lookback || 24);
  if (pos > maxPos) return true;
  if (boll && boll.mid[i] != null && boll.sd[i] > 0) {
    const z = dir * (klines[i].c - boll.mid[i]) / boll.sd[i];
    if (z > maxZ) return true;
  }
  return false;
}

// 判断是否撞在「多重受阻压力天花板 / 支撑地板」或带阻滞影线的布林极端外沿（放行干净真突破）
export function isBlockedByWall(klines, i, dir, at, boll) {
  if (!klines || i < 4 || !at) return false;
  const k = klines[i];
  const m0 = candleMetrics(k);
  const oppWickRatio = m0.range > 0 ? (dir > 0 ? m0.upWick / m0.range : m0.dnWick / m0.range) : 0;

  // 布林极端外沿：仅拦截冲出 ±2.2σ 且留明显阻滞影线的追顶/砸底，避免误杀干净单边真突破
  if (boll && boll.mid[i] != null && boll.sd[i] > 0) {
    const z = (k.c - boll.mid[i]) / boll.sd[i];
    if (dir > 0 && z > 2.2 && oppWickRatio > 0.22) return true;
    if (dir < 0 && z < -2.2 && oppWickRatio > 0.22) return true;
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
  // 仅拦截仍在墙下未有效收破的撞墙单；若收盘明显突破墙顶 (> hi + 0.05 ATR) 视为真突破放行
  if (dir > 0 && k.c <= hi + at * 0.05 && (hi - k.c) < at * 0.90) {
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
  if (dir < 0 && k.c >= lo - at * 0.05 && (k.c - lo) < at * 0.90) {
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
  const sess = sessionProfileForTs(nowMs, state.tf);
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

function buildOrder(klines, i, dir, pattern, atrVal, sess, is3m) {
  const k = klines[i];
  const entry = k.c;
  const floor = (mkt && mkt().atrFloor) || 0.4;
  const unit = Math.max(Number(atrVal) || 0, floor);

  // 双向限幅结构止损：形态紧凑时按形态极值外侧缓冲适度收紧止损（不低于基础止损 0.85 倍），
  // 形态影线略长时适度外推防插针（3m 不超过基础止损 + 0.22 ATR，其余周期 + 0.30 ATR），避免单笔止损过大
  const baseSlDist = unit * sess.slMult;
  const minSlDist = baseSlDist * STRUCT_SL_MIN_RATIO;
  const maxExtra = is3m ? ANTI_WICK_MAX_EXTRA_ATR_3M : ANTI_WICK_MAX_EXTRA_ATR;
  const maxSlDist = unit * (sess.slMult + maxExtra);
  let slDist = baseSlDist;
  const isSingleExt = pattern && (
    pattern.code === 'sweep_up' || pattern.code === 'sweep_dn' ||
    pattern.code === 'bb_snap_up' || pattern.code === 'bb_snap_dn'
  );
  const lookBars = isSingleExt ? 1 : Math.max((pattern && pattern.bars) || 2, 2);
  let patExt = dir > 0 ? Infinity : -Infinity;
  for (let j = Math.max(0, i - lookBars + 1); j <= i; j++) {
    patExt = dir > 0 ? Math.min(patExt, klines[j].l) : Math.max(patExt, klines[j].h);
  }
  if (Number.isFinite(patExt)) {
    const structDist = dir * (entry - patExt) + unit * ANTI_WICK_BUF_ATR;
    if (structDist > 0) {
      slDist = Math.min(maxSlDist, Math.max(minSlDist, structDist));
    }
  }

  // 第一止盈与止损严格保持 1:1（按盘口 tp1/sl 比例映射），TP2 等比映射，避免大止损小止盈导致亏损偏大
  const tp1Dist = slDist * (sess.tp1Mult / sess.slMult);
  const tp2Dist = slDist * (sess.tp2Mult / sess.slMult);
  const origSl = dir > 0 ? entry - slDist : entry + slDist;
  const tp1 = dir > 0 ? entry + tp1Dist : entry - tp1Dist;
  const tp2 = dir > 0 ? entry + tp2Dist : entry - tp2Dist;
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
  const why = '反推增强版在一分钟 K 线收盘后结合 EMA100 斜率与强实体确认判断多空，含防插针摆动止损与 TP1 移动保本。';
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
  const setupByIndex = new Map();
  for (let s = 0; s < setups.length; s++) {
    setupByIndex.set(setups[s].i, setups[s]);
  }
  const marks = [];
  const history = [];
  let active = null;

  function openXaudzOrder(setup) {
    const t = klines[setup.i].t;
    const mark = {
      ...setup,
      t,
      id: t + ':' + setup.dir + ':xaudz',
      pattern: { name: 'xaudz 反推版', code: 'xaudz' },
      session: sessionProfileForTs(t * 1000),
    };
    marks.push(mark);
    return {
      ...mark,
      origSl: mark.sl,
      status: 'open',
      hitTp1: false,
      hitTp1I: -1,
      breakeven: false,
      exitI: -1,
      exitPx: null,
    };
  }

  for (let i = 0; i <= end; i++) {
    const bar = klines[i];
    if (active) {
      const stopHit = active.dir > 0 ? bar.l <= active.sl : bar.h >= active.sl;
      if (stopHit) {
        Object.assign(active, { status: active.breakeven ? 'be' : 'sl', exitI: i, exitPx: active.sl });
        history.push(active);
        active = null;
      } else {
        const favorable = active.dir > 0 ? bar.h : bar.l;
        if (!active.hitTp1 && active.dir * (favorable - active.tp1) >= 0) {
          active.hitTp1 = true;
          active.hitTp1I = i;
          active.breakeven = true;
          active.sl = active.entry;
        }
        if (active.dir * (favorable - active.tp2) >= 0) {
          Object.assign(active, { status: 'tp2', exitI: i, exitPx: active.tp2 });
          history.push(active);
          active = null;
        }
      }
    }

    const setup = setupByIndex.get(i);
    if (!setup) continue;
    // 持仓期间忽略同方向重复信号，仅在反向信号出现时反手平仓，避免同向新信号强杀未走完的持仓。
    if (!active) {
      active = openXaudzOrder(setup);
    } else if (setup.dir !== active.dir) {
      Object.assign(active, { status: 'flip', exitI: i, exitPx: setup.entry });
      history.push(active);
      active = openXaudzOrder(setup);
    }
  }

  const lastClosed = history.at(-1) || null;
  const lastPx = ticker?.last > 0 && Number.isFinite(ticker.last) ? ticker.last : klines.at(-1).c;
  const pnlPts = active ? active.dir * (lastPx - active.entry) : null;
  const tp1Hits = history.filter((order) => order.hitTp1).length;
  const wins = history.filter((order) => {
    if (order.hitTp1 || order.status === 'tp2' || order.status === 'be') return true;
    if (order.status === 'flip') return order.dir * (order.exitPx - order.entry) > 0;
    return false;
  }).length;
  const label = active
    ? (active.dir > 0 ? '做多' : '做空') + ' · 开 ' + px(active.entry)
    : '等待信号';
  let rfSignal = active?.hitTp1 ? (active.breakeven ? '已触 TP1 · 移动保本' : '已触及 TP1') : label;
  if (!active && lastClosed?.exitI === end && lastClosed.status === 'tp2') rfSignal = '已达 TP2 止盈';
  return {
    ...pack,
    ok: true,
    sig: ['xaudz', klines[end].t, active?.id, active?.hitTp1, active?.breakeven, lastClosed?.status].join('|'),
    label, rfSignal, active, lastClosed, history, pnlPts, lastPx,
    pnlPct: active ? (pnlPts / active.entry) * 100 : null,
    orderSession: active?.session || pack.session,
    marks: marks.slice(-5),
    stats: {
      total: history.length, wins, tp1Hits, losses: history.length - wins,
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
  const rf = computeRangeFilter(closes, RF_PERIOD, RF_MULT);
  const end = Math.max(14, pbClosedEnd(klines));
  const hasForming = end < n - 1;
  const floor = (mkt && mkt().atrFloor) || 0.4;
  const isStrict = mode === 'strict';
  const useWall = mode === 'safe' || mode === 'strict';
  const tf = state.tf || '1m';
  const is3m = tf === '3m';
  const isShortTf = SHORT_TFS.has(tf);

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

    // 1. 先检查当前持仓是否触发止损 / TP1（自动移动保本）/ TP2
    if (active) {
      if (active.dir > 0) {
        if (k.l <= active.sl) {
          active.status = active.breakeven ? 'be' : 'sl';
          active.exitI = i;
          active.exitPx = active.sl;
          lastClosed = active;
          history.push(active);
          if (!active.hitTp1) {
            if (isStrict) coolUntil = i + 2;
            else if (mode === 'safe') coolUntil = i + 1;
          }
          active = null;
        } else {
          if (!active.hitTp1 && k.h >= active.tp1) {
            active.hitTp1 = true;
            active.hitTp1I = i;
            active.breakeven = true;
            active.sl = active.entry + active.atr * BE_CUSHION_ATR;
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
          active.status = active.breakeven ? 'be' : 'sl';
          active.exitI = i;
          active.exitPx = active.sl;
          lastClosed = active;
          history.push(active);
          if (!active.hitTp1) {
            if (isStrict) coolUntil = i + 2;
            else if (mode === 'safe') coolUntil = i + 1;
          }
          active = null;
        } else {
          if (!active.hitTp1 && k.l <= active.tp1) {
            active.hitTp1 = true;
            active.hitTp1I = i;
            active.breakeven = true;
            active.sl = active.entry - active.atr * BE_CUSHION_ATR;
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

    // 统一风控：未触达 TP1 前严禁反向信号提前割肉平仓；仅触达 TP1 锁利后遇反向合格信号才锁利反手
    if (i < 20) continue;
    if (active && !active.hitTp1) continue;
    if (!active && i <= coolUntil) continue;

    if (isShortTf) {
      // 1m / 3m / 5m 分钟级极值反转与流动性扫荡内核：
      // 1) 剔除低胜率顺势追高破位与早割反手，优先 8 根流动性扫荡收回 + 核心极值反转（5m 叠加布林 ±2σ 外轨收回）
      // 2) 结合防追顶护盾、防逆势急瀑接飞刀与亏损冷却，三档胜率清晰递进
      let patS = detectSweepPattern(klines, i, atrArr, 8);
      if (!patS) patS = detectBarPattern(klines, i, atrArr, 'classic');
      if (!patS && tf === '5m') patS = detectBbSnapPattern(klines, i, effAt, boll);
      if (!patS) continue;

      const isBb = patS.code === 'bb_snap_up' || patS.code === 'bb_snap_dn';
      const isSweep = patS.code === 'sweep_up' || patS.code === 'sweep_dn';
      const isPin = patS.code === 'hammer' || patS.code === 'shooting_star';
      const isEngulf = patS.code === 'bull_engulf' || patS.code === 'bear_engulf';
      if (!isBb && (isStrict ? !STRICT_SHORT_CODES.has(patS.code) : !CORE_SHORT_CODES.has(patS.code))) continue;

      const m0 = candleMetrics(k);
      const dir = patS.dir;
      const rangeAtr = m0.range / effAt;
      const bodyAtr = m0.body / effAt;
      const cp = dir > 0 ? m0.closePos : (1 - m0.closePos);
      const oppWickRatio = m0.range > 0 ? (dir > 0 ? m0.upWick / m0.range : m0.dnWick / m0.range) : 0;
      const z = boll.sd[i] > 0 ? (dir * (k.c - boll.mid[i]) / boll.sd[i]) : 0;
      const zExt = boll.sd[i] > 0
        ? (dir > 0 ? -(k.l - boll.mid[i]) / boll.sd[i] : (k.h - boll.mid[i]) / boll.sd[i])
        : 0;
      const distE20 = dir * (k.c - e20[i]) / effAt;
      const distE50 = dir * (k.c - e50[i]) / effAt;
      const r = rsi14[i] != null ? rsi14[i] : 50;
      const rDir = dir > 0 ? r : (100 - r);
      const er = efficiencyRatio(closes, i, 14);
      const prev3Drop = -dir * (klines[i - 1].c - klines[Math.max(0, i - 4)].c) / effAt;
      const e50Slope = dir * (e50[i] - e50[Math.max(0, i - 5)]) / effAt;
      const againstStrongE50 = e50Slope < -0.25 && distE50 < -0.5;

      let hi8 = -Infinity;
      let lo8 = Infinity;
      for (let j = Math.max(0, i - 8); j < i - 1; j++) {
        if (klines[j].h > hi8) hi8 = klines[j].h;
        if (klines[j].l < lo8) lo8 = klines[j].l;
      }
      const touched8 = isSweep || isPin || isBb || (dir > 0
        ? Math.min(k.l, klines[i - 1].l) <= lo8 + effAt * 0.15
        : Math.max(k.h, klines[i - 1].h) >= hi8 - effAt * 0.15);

      const chasingS = useWall && (
        isChasingExtreme(klines, i, dir, effAt, boll, { lookback: 24, maxPos: 0.65, maxZ: 0.85 }) ||
        distE20 > 0.90 || rDir > 58
      );

      const withE50 = dir > 0
        ? (e20[i] > e50[i] && k.c > e50[i])
        : (e20[i] < e50[i] && k.c < e50[i]);
      const e20SlopeOk = dir > 0
        ? (e20[i] >= e20[Math.max(0, i - 3)])
        : (e20[i] <= e20[Math.max(0, i - 3)]);

      let qualifiedS = false;
      if (is3m) {
        if (mode === 'classic') {
          const noKnife = !againstStrongE50 || z <= -1.25;
          qualifiedS = noKnife && rangeAtr <= 1.85 && z <= 0.05 && rDir <= 53 &&
            (isSweep || (touched8 && prev3Drop >= 0.35));
        } else if (mode === 'safe') {
          const noKnife = !againstStrongE50 || z <= -1.35;
          qualifiedS = !chasingS && noKnife && rangeAtr <= 1.85 && z <= -0.50 && rDir <= 46 && zExt >= 1.8 &&
            ((isSweep && prev3Drop >= 0.22) || (touched8 && prev3Drop >= 0.45));
        } else {
          qualifiedS = !chasingS && er >= STRICT_3M_ER_MIN && rangeAtr <= 1.85 && z <= -1.05 && rDir <= 44 &&
            ((isSweep && prev3Drop >= 0.25) || (touched8 && prev3Drop >= 0.50));
        }
      } else if (tf === '1m') {
        const trendContEngulf = isEngulf && withE50 && e20SlopeOk && rfD === dir &&
          cp >= 0.72 && oppWickRatio <= 0.15 && bodyAtr >= 1.15 && rangeAtr <= 2.60 && er >= 0.45;
        if (mode === 'classic') {
          const rev1m = rangeAtr <= 1.85 && z <= 0.0 && rDir <= 52 &&
            (isSweep || (touched8 && prev3Drop >= 0.35));
          qualifiedS = rev1m || trendContEngulf;
        } else if (mode === 'safe') {
          qualifiedS = !chasingS && e50Slope >= -0.15 && rangeAtr <= 1.85 && z <= -0.35 && rDir <= 50 &&
            ((isSweep && prev3Drop >= 0.20) || (touched8 && prev3Drop >= 0.35));
        } else {
          qualifiedS = !chasingS && er >= 0.16 && e50Slope >= -0.15 && rangeAtr <= 1.85 &&
            z <= -0.75 && rDir <= 46 && ((isSweep && prev3Drop >= 0.25) || (touched8 && prev3Drop >= 0.45));
        }
      } else {
        // 5m：布林 ±2σ 外轨收回 + 极值扫荡反转 + 顺势 EMA20 回踩强吞没
        const dippedE20 = dir > 0
          ? (Math.min(k.l, klines[i - 1].l) <= e20[i] + effAt * 0.20 && k.c > e20[i])
          : (Math.max(k.h, klines[i - 1].h) >= e20[i] - effAt * 0.20 && k.c < e20[i]);
        const trendPbEngulf = isEngulf && withE50 && e20SlopeOk && dippedE20 &&
          rfD === dir && cp >= 0.62 && oppWickRatio <= 0.25 && distE20 <= 1.6 && rDir <= 68 && er >= 0.16 && rangeAtr <= 1.85;

        if (mode === 'classic') {
          const rev5 = rangeAtr <= 1.90 && z <= 0.0 && rDir <= 52 &&
            (isBb || isSweep || (touched8 && prev3Drop >= 0.35));
          qualifiedS = rev5 || trendPbEngulf;
        } else if (mode === 'safe') {
          const bbOk = isBb && rDir <= 50;
          const revOk = rangeAtr <= 1.85 && z <= -0.50 && rDir <= 48 &&
            ((isSweep && prev3Drop >= 0.25) || (touched8 && prev3Drop >= 0.45 && zExt >= 1.6));
          qualifiedS = (!chasingS && (bbOk || revOk)) || (trendPbEngulf && !chasingS);
        } else {
          const bbStrict = !chasingS && er >= 0.14 && isBb && rDir <= 48 && prev3Drop >= 0.35;
          const revStrict = !chasingS && er >= 0.16 && rangeAtr <= 1.85 && z <= -0.60 && rDir <= 48 &&
            ((isSweep && prev3Drop >= 0.30) || (touched8 && prev3Drop >= 0.45 && zExt >= 1.8));
          qualifiedS = bbStrict || revStrict || trendPbEngulf;
        }
      }

      if (!qualifiedS) continue;

      const sessS = sessionProfileForTs(k.t * 1000, tf);
      if (!active) {
        active = buildOrder(klines, i, dir, patS, at, sessS, is3m);
        marks.push({
          i: i,
          t: k.t,
          dir: dir,
          entry: active.entry,
          sl: active.origSl,
          tp1: active.tp1,
          tp2: active.tp2,
          pattern: patS,
          session: sessS,
        });
      } else if (active.hitTp1 && active.dir !== dir) {
        active.status = 'flip';
        active.exitI = i;
        active.exitPx = k.c;
        lastClosed = active;
        history.push(active);
        active = buildOrder(klines, i, dir, patS, at, sessS, is3m);
        marks.push({
          i: i,
          t: k.t,
          dir: dir,
          entry: active.entry,
          sl: active.origSl,
          tp1: active.tp1,
          tp2: active.tp2,
          pattern: patS,
          session: sessS,
        });
      }
      continue;
    }

    // 15m 及以上大周期：顺势 EMA20/EMA50 回踩均线强实体确认（避免大单边逆势摸顶抄底），严禁未达 TP1 提前割肉
    const m0 = candleMetrics(k);
    const rangeAtr = m0.range / effAt;
    if (rangeAtr < 0.40 || rangeAtr > 2.2) continue;
    const erHt = efficiencyRatio(closes, i, 14);
    let patHt = null;
    for (let dIdx = 0; dIdx < 2; dIdx++) {
      const dir = dIdx === 0 ? 1 : -1;
      const withE50Slope = dir > 0
        ? (e20[i] > e50[i] && e50[i] >= e50[Math.max(0, i - 5)] && e20[i] >= e20[Math.max(0, i - 3)])
        : (e20[i] < e50[i] && e50[i] <= e50[Math.max(0, i - 5)] && e20[i] <= e20[Math.max(0, i - 3)]);
      if (!withE50Slope) continue;
      const dipped = dir > 0
        ? (Math.min(k.l, klines[i - 1].l) <= Math.max(e9[i], e20[i]) + effAt * 0.25 && k.c > e9[i])
        : (Math.max(k.h, klines[i - 1].h) >= Math.min(e9[i], e20[i]) - effAt * 0.25 && k.c < e9[i]);
      const cp = dir > 0 ? m0.closePos : (1 - m0.closePos);
      const candleOk = (dir > 0 ? m0.bull : m0.bear) && cp >= 0.60 && m0.body >= effAt * 0.35;
      if (!dipped || !candleOk) continue;

      const z = boll.sd[i] > 0 ? (dir * (k.c - boll.mid[i]) / boll.sd[i]) : 0;
      const pos24 = rangePosInDir(klines, i, dir, effAt, 24);
      const chasingHt = useWall && isChasingExtreme(klines, i, dir, effAt, boll, { lookback: 24, maxPos: 0.78, maxZ: 1.4 });
      const onE20 = dir > 0 ? k.c > e20[i] : k.c < e20[i];

      let okHt = false;
      if (mode === 'classic') {
        okHt = z <= 1.5 && pos24 <= 0.85;
      } else if (mode === 'safe') {
        okHt = !chasingHt && z <= 1.2 && pos24 <= 0.75;
      } else {
        okHt = !chasingHt && (rfD === dir || onE20) && erHt >= 0.14 && cp >= 0.62;
      }
      if (!okHt) continue;

      const rawPat = detectSweepPattern(klines, i, atrArr, 8) || detectBarPattern(klines, i, atrArr, 'classic');
      patHt = (rawPat && rawPat.dir === dir)
        ? rawPat
        : {
          dir: dir,
          name: dir > 0 ? '顺势回踩多' : '顺势反抽空',
          code: dir > 0 ? 'trend_pb_up' : 'trend_pb_dn',
          weight: 2,
          bars: 2,
        };
      break;
    }

    if (!patHt) continue;
    const sessHt = sessionProfileForTs(k.t * 1000, tf);
    if (!active) {
      active = buildOrder(klines, i, patHt.dir, patHt, at, sessHt, false);
      marks.push({
        i: i,
        t: k.t,
        dir: patHt.dir,
        entry: active.entry,
        sl: active.origSl,
        tp1: active.tp1,
        tp2: active.tp2,
        pattern: patHt,
        session: sessHt,
      });
    } else if (active.hitTp1 && active.dir !== patHt.dir) {
      active.status = 'flip';
      active.exitI = i;
      active.exitPx = k.c;
      lastClosed = active;
      history.push(active);
      active = buildOrder(klines, i, patHt.dir, patHt, at, sessHt, false);
      marks.push({
        i: i,
        t: k.t,
        dir: patHt.dir,
        entry: active.entry,
        sl: active.origSl,
        tp1: active.tp1,
        tp2: active.tp2,
        pattern: patHt,
        session: sessHt,
      });
    }
  }

  // 未收盘 K 线只作预备提示，不提前确认开仓
  let forming = null;
  if (hasForming) {
    const fAt = Math.max(atrArr[n - 1] || atrArr[end] || 0, floor);
    const fPat = isShortTf
      ? (detectSweepPattern(klines, n - 1, atrArr, 8) ||
        detectBarPattern(klines, n - 1, atrArr, 'classic') ||
        (tf === '5m' ? detectBbSnapPattern(klines, n - 1, fAt, boll) : null))
      : (detectBarPattern(klines, n - 1, atrArr, mode) || detectLowLatencyPattern(klines, n - 1, atrArr, e9, e20));
    const skipForming = fPat && (isShortTf
      ? (isStrict ? !STRICT_SHORT_CODES.has(fPat.code) : !CORE_SHORT_CODES.has(fPat.code))
      : (fPat.code === 'inside_up' || fPat.code === 'inside_dn' ||
        (isStrict && (fPat.code === 'pb_reject_up' || fPat.code === 'pb_reject_dn'))));
    if (fPat && !skipForming && (!active || active.dir !== fPat.dir)) {
      forming = fPat;
    }
  }

  // 趋势方向判定（结合 RF 与 EMA20/EMA50）
  const rfDirNow = rf.dir[end] || 0;
  const erNow = efficiencyRatio(closes, end, 14);
  const emaDir = e20[end] > e50[end] ? 1 : (e20[end] < e50[end] ? -1 : 0);
  const cEnd = klines[end].c;
  const fEnd = rf.filt[end];
  const chopMin = is3m || tf === '1m' ? STRICT_3M_ER_MIN : 0.14;
  const chopFiltered = isStrict && erNow < chopMin;

  let trendDir = 0;
  if (rfDirNow > 0 && (emaDir >= 0 || cEnd >= fEnd)) trendDir = 1;
  else if (rfDirNow < 0 && (emaDir <= 0 || cEnd <= fEnd)) trendDir = -1;
  else if (emaDir !== 0 && ((emaDir > 0 && cEnd > e20[end]) || (emaDir < 0 && cEnd < e20[end]))) trendDir = emaDir;

  const trendLab = trendDir > 0 ? '多头趋势' : (trendDir < 0 ? '空头趋势' : '震荡整理');

  const lastBar = klines[n - 1];
  const livePx = (ticker && Number.isFinite(ticker.last) && ticker.last > 0) ? ticker.last : lastBar.c;
  const liveSess = sessionProfileForTs(now, tf);
  const atEnd = Math.max(atrArr[end] || 0, floor);

  // 空仓时给出参考建议（趋势回踩或压力/支撑反转观察）
  let watch = null;
  if (!active && livePx != null && trendDir !== 0 && !chopFiltered) {
    let wDir = trendDir;
    let wKind = 'trend';
    const watchBlocked = useWall && (mode === 'safe'
      ? isChasingExtreme(klines, end, wDir, atEnd, boll, {
        lookback: 24,
        maxPos: isShortTf ? 0.65 : 0.78,
        maxZ: isShortTf ? 0.85 : 1.4,
      })
      : isBlockedByWall(klines, end, wDir, atEnd, boll));
    if (watchBlocked) {
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
