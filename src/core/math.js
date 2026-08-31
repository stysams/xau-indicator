import { n } from './format.js';
import { state } from '../state.js';

export function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  let e = values[0];
  const out = [e];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function emaSkipNull(values, period) {
  const n = values.length;
  const out = new Array(n).fill(null);
  const k = 2 / (period + 1);
  let e = null;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v == null) {
      out[i] = e;
      continue;
    }
    e = e == null ? v : (v * k + e * (1 - k));
    out[i] = e;
  }
  return out;
}

export function rollingHL(klines, period) {
  const n = klines.length;
  const hi = new Array(n).fill(null);
  const lo = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (klines[j].h > h) h = klines[j].h;
      if (klines[j].l < l) l = klines[j].l;
    }
    hi[i] = h;
    lo[i] = l;
  }
  return { hi: hi, lo: lo };
}

export function bollCore(closes, period) {
  period = period || 20;
  const n = closes.length;
  const mid = new Array(n).fill(null);
  const sd = new Array(n).fill(null);
  if (n < period) return { mid: mid, sd: sd };
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i < period - 1) continue;
    const m = sum / period;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - m;
      acc += d * d;
    }
    mid[i] = m;
    sd[i] = Math.sqrt(acc / period);
  }
  return { mid: mid, sd: sd };
}

export function bandArr(mid, sd, k) {
  const up = new Array(mid.length).fill(null);
  const dn = new Array(mid.length).fill(null);
  for (let i = 0; i < mid.length; i++) {
    if (mid[i] == null || sd[i] == null) continue;
    up[i] = mid[i] + k * sd[i];
    dn[i] = mid[i] - k * sd[i];
  }
  return { up: up, dn: dn };
}

export function macdOf(closes) {
  const n = closes.length;
  const empty = { dif: new Array(n).fill(null), dea: new Array(n).fill(null), hist: new Array(n).fill(null) };
  if (n < 26) return empty;
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const difRaw = closes.map((_, i) => e12[i] - e26[i]);
  const deaRaw = ema(difRaw, 9);
  // EMA12+EMA26 预热后 DIF 才稳；再加 DEA9，前 33 根屏蔽
  const warm = 33;
  const dif = difRaw.map((v, i) => (i < warm ? null : v));
  const dea = deaRaw.map((v, i) => (i < warm || v == null ? null : v));
  const hist = dif.map((v, i) => (v == null || dea[i] == null ? null : 2 * (v - dea[i])));
  return { dif: dif, dea: dea, hist: hist };
}

export function percentileRank(arr, value) {
  const xs = arr.filter((v) => v != null);
  if (!xs.length || value == null) return null;
  let c = 0;
  for (let i = 0; i < xs.length; i++) if (xs[i] <= value) c++;
  return c / xs.length;
}

export function bwRankWindow(tf) {
  if (tf === '10s' || tf === '1m') return 120;
  if (tf === '5m') return 96;
  if (tf === '15m') return 80;
  return 64;
}

// 日内 VWAP：有成交量时按典型价格加权；黄金无统一现货成交量时退化为日内典型价格均值。
export function vwapSeries(klines) {
  const out = new Array((klines || []).length).fill(null);
  let day = null, pv = 0, vol = 0, mean = 0, count = 0;
  (klines || []).forEach((k, i) => {
    const d = new Date((k.t || 0) * 1000).toISOString().slice(0, 10);
    if (d !== day) { day = d; pv = 0; vol = 0; mean = 0; count = 0; }
    const typical = (k.h + k.l + k.c) / 3;
    const volume = Number(k.v != null ? k.v : k.volume);
    if (Number.isFinite(volume) && volume > 0) {
      pv += typical * volume;
      vol += volume;
      out[i] = pv / vol;
    } else {
      mean += typical;
      count += 1;
      out[i] = mean / count;
    }
  });
  return out;
}

export function rsiSeries(closes, period) {
  period = period || 14;
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / period, al = loss / period;
  out[period] = (ag === 0 && al === 0) ? 50 : (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = (ag === 0 && al === 0) ? 50 : (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return out;
}

export function rsi(closes, period) {
  const s = rsiSeries(closes, period || state.rsiN || 14);
  return s.length ? s[s.length - 1] : null;
}

export function atr(klines, period) {
  period = period || 14;
  if (!klines || klines.length < period + 1) return null;
  // 固定取末尾窗口，避免切主图周期时同一段 1m 因前置长度不同而 ATR 漂移
  const warm = period * 5;
  const from = Math.max(0, klines.length - (warm + 1));
  const win = from > 0 ? klines.slice(from) : klines;
  if (win.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < win.length; i++) {
    const c = win[i], p = win[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  let a = 0;
  for (let i = 0; i < period; i++) a += trs[i];
  a /= period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

export function swings(klines, k) {
  k = k || 2;
  const highs = [], lows = [];
  for (let i = k; i < klines.length - k; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= k; j++) {
      if (!(klines[i].h > klines[i - j].h && klines[i].h >= klines[i + j].h)) isH = false;
      if (!(klines[i].l < klines[i - j].l && klines[i].l <= klines[i + j].l)) isL = false;
    }
    if (isH) highs.push(klines[i].h);
    if (isL) lows.push(klines[i].l);
  }
  return { highs: highs.slice(-2), lows: lows.slice(-2) };
}
