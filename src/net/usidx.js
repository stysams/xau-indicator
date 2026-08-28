import { n } from '../core/format.js';
import { getJson } from './rest.js';
import { state } from '../state.js';

const SYMBOL = 'USIDX';

export function parseUsidxTicker(raw) {
  const d = (raw && raw.data) || {};
  return {
    last: n(d.last_price),
    bid: n(d.bid_price),
    ask: n(d.ask_price),
    high: n(d.highest_price),
    low: n(d.lowest_price),
    chg: n(d.price_change),
    chgAmt: n(d.price_change_amount),
    status: d.status || '',
  };
}

export function parseUsidxKlines(raw) {
  const list = Array.isArray(raw) ? raw : ((((raw || {}).data) || {}).list || []);
  return list.map((k) => ({
    t: n(k.t), o: n(k.o), h: n(k.h), l: n(k.l), c: n(k.c),
  })).filter((k) => k.t && k.c != null).sort((a, b) => a.t - b.t);
}

export function usidxKlineUrl(tf, limit) {
  return '/api/v4/tradfi/symbols/' + SYMBOL + '/klines?kline_type=' + encodeURIComponent(tf) + '&limit=' + encodeURIComponent(limit);
}

export function usidxTickerUrl() {
  return '/api/v4/tradfi/symbols/' + SYMBOL + '/tickers';
}

export async function loadUsidx() {
  if (!state.ind.usidx || state.usidxInflight) return false;
  const reqId = ++state.usidxReqId;
  state.usidxInflight = true;
  try {
    const [tk, kl] = await Promise.all([
      getJson(usidxTickerUrl()),
      getJson(usidxKlineUrl(state.tf === '10s' ? '1m' : state.tf, Math.min(state.limit, 480))),
    ]);
    if (!state.ind.usidx || reqId !== state.usidxReqId) return false;
    state.usidxTicker = parseUsidxTicker(tk);
    state.usidxBars = parseUsidxKlines(kl);
    return true;
  } catch (e) {
    return false;
  } finally {
    if (reqId === state.usidxReqId) state.usidxInflight = false;
  }
}

export function clearUsidx() {
  state.usidxReqId += 1;
  state.usidxInflight = false;
  state.usidxTicker = null;
  state.usidxBars = [];
}

export function mergeUsidxTicker(row) {
  if (!state.ind.usidx || !row) return;
  const current = state.usidxTicker || {};
  const next = parseUsidxTicker({ data: row });
  Object.keys(next).forEach((key) => { if (next[key] != null) current[key] = next[key]; });
  state.usidxTicker = current;
  state.usidxBars = state.usidxBars || [];
  const last = current.last;
  if (last == null) return;
  const t = Math.floor(Date.now() / 60000) * 60;
  const prev = state.usidxBars[state.usidxBars.length - 1];
  if (!prev || prev.t !== t) {
    state.usidxBars = state.usidxBars.concat([{ t: t, o: last, h: last, l: last, c: last }]).slice(-480);
  } else {
    state.usidxBars[state.usidxBars.length - 1] = Object.assign({}, prev, { c: last, h: Math.max(prev.h, last), l: Math.min(prev.l, last) });
  }
}
