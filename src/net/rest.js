import { n } from '../core/format.js';
import { LIVE_ANCHOR, mkt, state, streamTfs } from '../state.js';

export async function getJson(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  let data = null;
  try { data = await res.json(); }
  catch (e) { throw new Error('上游返回非 JSON'); }
  if (!res.ok || (data && !Array.isArray(data) && data.label)) {
    throw new Error((data && (data.message || data.label)) || ('HTTP ' + res.status));
  }
  return data;
}

export function parseTicker(raw) {
  if (mkt().kind === 'perp') {
    const d = (Array.isArray(raw) ? raw[0] : raw) || {};
    const last = n(d.last);
    const chgAmt = n(d.change_price);
    const prev = last != null && chgAmt != null ? last - chgAmt : null;
    return {
      last: last,
      bid: n(d.highest_bid),
      ask: n(d.lowest_ask),
      high: n(d.high_24h),
      low: n(d.low_24h),
      chg: n(d.change_percentage),
      chgAmt: chgAmt,
      open: prev,
      prev: prev,
      status: 'open',
      closeTime: n(d.funding_next_apply) || 0,
      openTime: 0,
      settle: (mkt().settle || 'usdt').toUpperCase(),
      category: 'USDT 永续',
      funding: n(d.funding_rate),
      mark: n(d.mark_price),
    };
  }
  const d = (raw && raw.data) || {};
  return {
    last: n(d.last_price),
    bid: n(d.bid_price),
    ask: n(d.ask_price),
    high: n(d.highest_price),
    low: n(d.lowest_price),
    chg: n(d.price_change),
    chgAmt: n(d.price_change_amount),
    open: n(d.today_open_price),
    prev: n(d.last_today_close_price),
    status: d.status || '',
    closeTime: n(d.close_time) || 0,
    openTime: n(d.open_time) || 0,
    settle: d.settlement_currency || '',
    category: d.category_name || '',
    funding: null,
    mark: null,
  };
}

export function parseKlines(raw) {
  const list = Array.isArray(raw) ? raw : ((((raw || {}).data) || {}).list || []);
  return list.map((k) => ({
    t: n(k.t), o: n(k.o), h: n(k.h), l: n(k.l), c: n(k.c),
  })).filter((k) => k.t && k.c != null).sort((a, b) => a.t - b.t);
}

export function tickerUrl() {
  const m = mkt();
  if (m.kind === 'perp') return '/api/v4/futures/' + m.settle + '/tickers?contract=' + encodeURIComponent(m.symbol);
  return '/api/v4/tradfi/symbols/' + m.symbol + '/tickers';
}

export function klineUrl(tf, limit) {
  const m = mkt();
  if (m.kind === 'perp') {
    return '/api/v4/futures/' + m.settle + '/candlesticks?contract=' + encodeURIComponent(m.symbol) +
      '&interval=' + encodeURIComponent(tf) + '&limit=' + encodeURIComponent(limit);
  }
  return '/api/v4/tradfi/symbols/' + m.symbol + '/klines?kline_type=' + encodeURIComponent(tf) +
    '&limit=' + encodeURIComponent(limit);
}

export function mergeLive(klines, last) {
  if (!klines.length || last == null) return klines;
  const out = klines.slice();
  const cur = Object.assign({}, out[out.length - 1]);
  cur.c = last;
  cur.h = Math.max(cur.h, last);
  cur.l = Math.min(cur.l, last);
  out[out.length - 1] = cur;
  return out;
}

export function barsForChart() {
  if (state.tf === '10s') return state.klines;
  if (state.wsOk && streamTfs().indexOf(state.tf) >= 0) return state.klines;
  return mergeLive(state.klines, state.ticker && state.ticker.last);
}

export function liveEndFor(n, count) {
  if (!n || !count) return count || 0;
  return n - 1 + count * (1 - LIVE_ANCHOR);
}

export function isLiveFollow(end, n, count) {
  return Math.abs(end - liveEndFor(n, count)) <= Math.max(0.75, count * 0.02);
}

export function parseStreamName(name) {
  const raw = String(name || '');
  const known = ['10s', '1m', '5m', '15m', '30m', '1h', '4h', '8h', '1d', '7d'];
  for (let i = 0; i < known.length; i++) {
    const iv = known[i];
    if (raw.startsWith(iv + '_')) return { interval: iv, symbol: raw.slice(iv.length + 1) };
  }
  return { interval: '', symbol: raw };
}

export function rowSymbol(row) {
  return (row && (row.symbol || row.contract || row.s)) || '';
}

export function upsertBar(list, bar, maxLen) {
  const src = list || [];
  if (!src.length) return [bar];
  const last = src[src.length - 1];
  if (bar.t > last.t) {
    const next = src.concat([bar]);
    if (next.length > maxLen) return next.slice(next.length - maxLen);
    return next;
  }
  if (bar.t === last.t) {
    const next = src.slice();
    next[next.length - 1] = bar;
    return next;
  }
  const next = src.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].t === bar.t) {
      next[i] = bar;
      break;
    }
    if (next[i].t < bar.t) break;
  }
  return next;
}
