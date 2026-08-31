import { n } from '../core/format.js';
import { parseStreamName, rowSymbol, upsertBar } from './rest.js';
import { FAST_LIMIT, MIN_BARS, mkt, state, streamTfs } from '../state.js';
import { mergeUsidxTicker } from './usidx.js';
import { applyTickBar, onFastBarClosed, tickFastOpen } from '../trade/fast.js';
import { renderQuote, scheduleChart, scheduleQuote } from '../view/panels.js';

export function applyTicker(row) {
  if (rowSymbol(row) && rowSymbol(row) !== mkt().symbol) return;
  const t = state.ticker || {};
  if (mkt().kind === 'perp') {
    if (row.last != null) t.last = n(row.last);
    if (row.high_24h != null) t.high = n(row.high_24h);
    if (row.low_24h != null) t.low = n(row.low_24h);
    if (row.change_price != null) {
      t.chgAmt = n(row.change_price);
      if (t.last != null && t.chgAmt != null) {
        t.prev = t.last - t.chgAmt;
        t.open = t.prev;
      }
    }
    if (row.change_percentage != null) t.chg = n(row.change_percentage);
    if (row.funding_rate != null) t.funding = n(row.funding_rate);
    if (row.funding_next_apply != null) t.closeTime = n(row.funding_next_apply);
    if (row.mark_price != null) t.mark = n(row.mark_price);
    t.status = 'open';
  } else {
    if (row.last_price != null) t.last = n(row.last_price);
    if (row.open_price != null) t.open = n(row.open_price);
    if (row.high != null) t.high = n(row.high);
    if (row.low != null) t.low = n(row.low);
    if (row.price_change_amount != null) t.chgAmt = n(row.price_change_amount);
    if (row.price_change_rate != null) t.chg = n(row.price_change_rate);
  }
  state.ticker = t;
  if (t.last != null) applyTickBar(t.last);
  scheduleQuote();
}

export function applyBook(row) {
  if (rowSymbol(row) && rowSymbol(row) !== mkt().symbol) return;
  const t = state.ticker || {};
  const bid = row.bid != null ? row.bid : row.b;
  const ask = row.ask != null ? row.ask : row.a;
  if (bid != null) t.bid = n(bid);
  if (ask != null) t.ask = n(ask);
  state.ticker = t;
  scheduleQuote();
}

export function applyUsidxCandle(row) {
  if (!state.ind.usidx || rowSymbol(row) !== 'USIDX') return;
  const bar = { t: n(row.t), o: n(row.o), h: n(row.h), l: n(row.l), c: n(row.c), v: n(row.v != null ? row.v : (row.volume != null ? row.volume : row.amount)) };
  if (!bar.t || bar.c == null) return;
  state.usidxBars = upsertBar(state.usidxBars || [], bar, 480);
  scheduleChart();
}

export function applyCandle(row) {
  const parsed = parseStreamName(row.n);
  if (parsed.symbol !== mkt().symbol) return;
  const bar = { t: n(row.t), o: n(row.o), h: n(row.h), l: n(row.l), c: n(row.c), v: n(row.v != null ? row.v : (row.volume != null ? row.volume : row.amount)) };
  if (!bar.t || bar.c == null) return;
  if (parsed.interval === '10s') {
    const lastFast = state.fast.length ? state.fast[state.fast.length - 1] : null;
    const closed = !!(row.w || (lastFast && bar.t > lastFast.t));
    state.fast = upsertBar(state.fast, bar, FAST_LIMIT);
    if (closed) onFastBarClosed();
    else tickFastOpen();
  }
  if (parsed.interval === state.tf) {
    if (!state.klines.length) return;
    const last = state.klines[state.klines.length - 1];
    const firstT = state.klines[0] && state.klines[0].t;
    if (row.w || (last && bar.t > last.t)) state.barClosed = true;
    state.klines = upsertBar(state.klines, bar, state.limit);
    if (!state.followLive && state.klines[0] && state.klines[0].t !== firstT && state.viewEnd != null) {
      state.viewEnd = Math.max(state.viewCount || MIN_BARS, state.viewEnd - 1);
    }
    scheduleChart();
  } else if (parsed.interval !== '10s' && streamTfs().indexOf(parsed.interval) >= 0) {
    state.mtf[parsed.interval] = upsertBar(state.mtf[parsed.interval] || [], bar, 80);
  }
}

export function onWs(msg) {
  if (!msg || msg.error) return;
  if (msg.event !== 'update') return;
  let rows = Array.isArray(msg.result) ? msg.result : (msg.result && typeof msg.result === 'object' ? [msg.result] : []);
  const ch = msg.channel || '';
  if (ch === 'tradfi.tickers' && state.ind.usidx) {
    rows.forEach((row) => {
      if (rowSymbol(row) === 'USIDX') {
        mergeUsidxTicker(row);
        scheduleChart();
      }
    });
    rows = rows.filter((row) => rowSymbol(row) !== 'USIDX');
  }
  if (ch === 'tradfi.tickers' || ch === 'futures.tickers') rows.forEach(applyTicker);
  else if (ch === 'tradfi.order_book' || ch === 'futures.book_ticker') rows.forEach(applyBook);
  else if (ch === 'tradfi.candlesticks' || ch === 'futures.candlesticks') {
    rows.forEach((row) => {
      if (rowSymbol(row) === 'USIDX') applyUsidxCandle(row);
      else applyCandle(row);
    });
  }
}

export function wsUrl() {
  const direct = mkt().kind === 'perp'
    ? 'wss://fx-ws.gateio.ws/v4/ws/usdt'
    : 'wss://fx-ws.gateio.ws/v4/ws/tradfi';
  if (!state.wsDirectFailed) return direct;
  const path = mkt().kind === 'perp' ? '/ws/futures' : '/ws/tradfi';
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path;
}

export function wsSend(obj) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj));
}

function subscribeUsidx(now) {
  if (!state.ind.usidx) return;
  wsSend({ time: now, channel: 'tradfi.tickers', event: 'subscribe', payload: { markets: ['USIDX'] } });
  wsSend({ time: now, channel: 'tradfi.candlesticks', event: 'subscribe', payload: ['1m', 'USIDX'] });
}

export function subscribeAll() {
  const now = Math.floor(Date.now() / 1000);
  const symbol = mkt().symbol;
  if (mkt().kind === 'perp') {
    wsSend({ time: now, channel: 'futures.tickers', event: 'subscribe', payload: [symbol] });
    wsSend({ time: now, channel: 'futures.book_ticker', event: 'subscribe', payload: [symbol] });
    streamTfs().forEach((tf) => {
      wsSend({ time: now, channel: 'futures.candlesticks', event: 'subscribe', payload: [tf, symbol] });
    });
    subscribeUsidx(now);
    return;
  }
  wsSend({ time: now, channel: 'tradfi.tickers', event: 'subscribe', payload: { markets: [symbol] } });
  wsSend({ time: now, channel: 'tradfi.order_book', event: 'subscribe', payload: [symbol] });
  streamTfs().forEach((tf) => {
    wsSend({ time: now, channel: 'tradfi.candlesticks', event: 'subscribe', payload: [tf, symbol] });
  });
  subscribeUsidx(now);
}

export function stopPing() {
  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = 0;
  }
}

export function startPing() {
  stopPing();
  state.pingTimer = setInterval(() => {
    const ch = mkt().kind === 'perp' ? 'futures.ping' : 'tradfi.ping';
    wsSend({ time: Math.floor(Date.now() / 1000), channel: ch });
  }, 20000);
}

export function scheduleReconnect() {
  if (!state.wsWanted || state.paused || location.protocol === 'file:') return;
  clearTimeout(state.reconn);
  const wait = state.backoff || 1000;
  state.backoff = Math.min(wait * 2, 15000);
  state.reconn = setTimeout(connectWs, wait);
}

export function disconnectWs() {
  state.wsWanted = false;
  stopPing();
  clearTimeout(state.reconn);
  if (state.ws) {
    try { state.ws.onclose = null; state.ws.close(); } catch (e) {}
    state.ws = null;
  }
  state.wsOk = false;
}

export function connectWs() {
  if (state.paused || location.protocol === 'file:') return;
  state.wsWanted = true;
  if (state.ws) {
    try { state.ws.onclose = null; state.ws.close(); } catch (e) {}
    state.ws = null;
  }
  let ws;
  try { ws = new WebSocket(wsUrl()); }
  catch (e) { scheduleReconnect(); return; }
  state.ws = ws;
  ws.addEventListener('open', () => {
    if (!state.wsWanted) return;
    state.wsOk = true;
    state.backoff = 1000;
    subscribeAll();
    startPing();
    renderQuote();
  });
  ws.addEventListener('message', (ev) => {
    if (state.paused || !state.wsWanted) return;
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    onWs(msg);
  });
  ws.addEventListener('close', () => {
    if (!state.wsWanted) return;
    const opened = state.wsOk;
    state.wsOk = false;
    if (!opened && !state.wsDirectFailed) state.wsDirectFailed = true;
    stopPing();
    renderQuote();
    scheduleReconnect();
  });
  ws.addEventListener('error', () => {});
}
