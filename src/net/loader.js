import { barsForChart, getJson, klineUrl, parseKlines, parseTicker, tickerUrl, upsertBar } from './rest.js';
import { $, FAST_LIMIT, state } from '../state.js';
import { applyTickBar, replayFastHistory } from '../trade/fast.js';
import { banner, render, renderHeavy, renderQuote, scheduleChart } from '../view/panels.js';
import { renderFastPanel } from '../view/trade-overlay.js';

export async function loadMain() {
  if (state.inflight) return;
  state.inflight = true;
  const reqId = state.reqId;
  try {
    const [tk, kl] = await Promise.all([
      getJson(tickerUrl()),
      getJson(klineUrl(state.tf, state.limit)),
    ]);
    if (reqId !== state.reqId) return;
    const snap = parseTicker(tk);
    state.ticker = Object.assign({}, state.ticker || {}, snap);
    state.klines = parseKlines(kl);
    state.chartScale = null;
    if (state.tf === '10s') {
      state.klines.forEach((bar) => {
        state.fast = upsertBar(state.fast, bar, FAST_LIMIT);
      });
    }
    if (state.tf === '10s' && state.ticker.last != null) applyTickBar(state.ticker.last);
    banner('', false);
    render();
    if (!state.fastReplay && state.fast.length >= 40) {
      replayFastHistory();
      if (state.fastReplay) {
        renderFastPanel();
        scheduleChart();
      }
    }
  } catch (e) {
    if (reqId !== state.reqId) return;
    const file = location.protocol === 'file:';
    banner(
      file
        ? '不能用文件方式打开。请在本目录运行 node serve.js，再访问 http://127.0.0.1:8787'
        : ('行情读取失败：' + (e && e.message ? e.message : e)),
      true
    );
    $('chartEmpty').textContent = state.tf === '10s' ? '没有拉到 10 秒 K 线' : '没有拉到 K 线';
    $('chartEmpty').style.display = 'grid';
  } finally {
    if (reqId === state.reqId) state.inflight = false;
  }
}

export async function loadSession() {
  const reqId = state.reqId;
  try {
    const tk = await getJson(tickerUrl());
    if (reqId !== state.reqId) return;
    const snap = parseTicker(tk);
    const t = Object.assign({}, state.ticker || {});
    t.status = snap.status;
    t.closeTime = snap.closeTime;
    t.openTime = snap.openTime;
    t.prev = snap.prev;
    t.settle = snap.settle;
    t.category = snap.category;
    t.funding = snap.funding;
    t.mark = snap.mark;
    if (!state.wsOk) {
      t.last = snap.last;
      t.bid = snap.bid;
      t.ask = snap.ask;
      t.high = snap.high;
      t.low = snap.low;
      t.chg = snap.chg;
      t.chgAmt = snap.chgAmt;
      t.open = snap.open;
    }
    state.ticker = t;
    renderQuote();
  } catch (e) { /* 实时通道仍可用 */ }
}

export async function loadOneMtf(tf) {
  const reqId = state.reqId;
  try {
    const kl = await getJson(klineUrl(tf, 80));
    if (reqId !== state.reqId) return false;
    const bars = parseKlines(kl);
    if (bars && bars.length) {
      state.mtf[tf] = bars;
      return true;
    }
  } catch (e) { /* 该周期稍后由推送补 */ }
  return false;
}

export async function loadMtf() {
  const reqId = state.reqId;
  try {
    await Promise.all(['1m', '5m', '15m', '1h'].map(loadOneMtf));
    if (reqId !== state.reqId) return;
    if (!state.fastReplay && state.fast.length >= 40) {
      replayFastHistory();
      if (state.fastReplay) scheduleChart();
    }
    renderHeavy(barsForChart());
    await Promise.all(['4h', '1d'].map(loadOneMtf));
    if (reqId !== state.reqId) return;
    renderHeavy(barsForChart());
  } catch (e) { /* 主图仍可用 */ }
}
