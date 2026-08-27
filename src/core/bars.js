import { bucket10 } from './format.js';
import { state } from '../state.js';

export function pbClosedEnd(klines) {
  if (!klines || !klines.length) return -1;
  const last = klines[klines.length - 1];
  if (klines.length >= 2 && Date.now() < last.t * 1000 + tfSpanMs(state.tf) - 200) return klines.length - 2;
  return klines.length - 1;
}

export function barsClosedAsOf(src, spanSec, t) {
  if (!src || !src.length || t == null) return src || [];
  let i = src.length;
  while (i > 0 && src[i - 1].t + spanSec > t) i--;
  return src.slice(0, i);
}

export function minuteBars() {
  if (state.tf === '1m' && state.klines.length) return state.klines;
  return state.mtf['1m'] || [];
}

export function fiveBars() {
  if (state.tf === '5m' && state.klines.length) return state.klines;
  return state.mtf['5m'] || [];
}

export function stackSrc(tf) {
  if (state.tf === tf && state.klines && state.klines.length) return state.klines;
  return (state.mtf && state.mtf[tf]) || [];
}

export function barsOpenedBefore(src, t) {
  if (!src || !src.length || t == null) return src || [];
  let i = src.length;
  while (i > 0 && src[i - 1].t > t) i--;
  return src.slice(0, i);
}

export function barsUpTo(src, t) { return barsOpenedBefore(src, t); }

export function closedFastBars(nowMs) {
  const bucket = bucket10(nowMs || Date.now());
  const list = state.fast || [];
  if (!list.length) return list;
  const last = list[list.length - 1];
  if (last.t >= bucket) return list.slice(0, -1);
  return list;
}

export function tfSpanMs(tf) {
  if (tf === '10s') return 10000;
  if (tf === '1m') return 60000;
  if (tf === '5m') return 5 * 60000;
  if (tf === '15m') return 15 * 60000;
  if (tf === '1h') return 60 * 60000;
  if (tf === '4h') return 4 * 60 * 60000;
  if (tf === '1d') return 24 * 60 * 60000;
  return 60000;
}

export function klinesClosed(klines, tf) {
  if (!klines || klines.length < 2) return klines || [];
  const last = klines[klines.length - 1];
  if (Date.now() < last.t * 1000 + tfSpanMs(tf) - 200) return klines.slice(0, -1);
  return klines;
}
