import { loadMain, loadMtf } from '../net/loader.js';
import { barsForChart, liveEndFor } from '../net/rest.js';
import { connectWs, disconnectWs } from '../net/ws.js';
import { $, MARKETS, MIN_BARS, MKT_KEY, PAD, W, mkt, state } from '../state.js';
import { loadFast } from '../trade/fast.js';
import { loadSim, refreshSimUi, saveSim } from '../trade/sim.js';
import { applySessChrome } from './session-rail.js';
import { drawChart, hideCrosshair, refreshCrosshair, wrap } from '../view/chart.js';
import { banner } from '../view/panels.js';
import { applyView, chartSlice, maxViewCount, resetZoom, updateZoomLabel } from '../view/viewport.js';

export function syncMarketChrome() {
  const m = mkt();
  document.title = m.title + ' · ' + m.symbol;
  if ($('pageTitle')) $('pageTitle').textContent = m.title;
  if ($('pageSub')) $('pageSub').textContent = m.sub;
  document.querySelectorAll('[data-mkt]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mkt === m.id));
  });
  if ($('remainLab')) $('remainLab').textContent = m.hasSession ? '本时段剩余' : '下次资金费';
  if ($('openLab')) $('openLab').textContent = m.hasSession ? '今开 / 昨收' : '24h开 / 参考昨收';
  applySessChrome();
  if ($('chartEmpty') && (!state.klines || !state.klines.length)) {
    $('chartEmpty').textContent = '正在拉取 ' + m.symbol + ' K 线';
  }
  const svg = $('chart');
  if (svg) svg.setAttribute('aria-label', m.name + ' K 线，滚轮缩放，拖动平移');
}

export function clearMarketData() {
  state.ticker = null;
  state.klines = [];
  state.mtf = {};
  state.fast = [];
  state.fastTrade = null;
  state.fastWatch = null;
  state.fastLast = null;
  state.fastHist = [];
  state.fastMarks = [];
  state.fastReplay = false;
  state.fastLastEvalT = 0;
  state.fastCoolUntil = 0;
  state._bmKey = '';
  state._hsKey = '';
  state._srKey = '';
  state._smcKey = '';
  state._pbKey = '';
  state._trapKey = '';
  state._holdKey = '';
  state.simOrders = [];
  state.simLastClose = null;
  state.hover = -1;
  state.barClosed = false;
  resetZoom();
}

export function switchMarket(id) {
  if (!MARKETS[id] || state.mkt === id) return;
  saveSim();
  disconnectWs();
  state.reqId += 1;
  state.inflight = false;
  state.wsDirectFailed = false;
  state.backoff = 1000;
  state.mkt = id;
  try { localStorage.setItem(MKT_KEY, id); } catch (e) {}
  clearMarketData();
  loadSim();
  refreshSimUi();
  syncMarketChrome();
  hideCrosshair();
  banner('', false);
  if ($('chartEmpty')) {
    $('chartEmpty').textContent = '正在拉取 ' + mkt().symbol + ' K 线';
    $('chartEmpty').style.display = 'grid';
  }
  if ($('lastPx')) $('lastPx').textContent = '--';
  loadMain();
  loadMtf();
  loadFast();
  if (!state.paused) connectWs();
}

export const COLOR_KEY = 'gold-minute-color';

export function applyColor(mode) {
  const next = mode === 'cn' ? 'cn' : 'us';
  document.documentElement.setAttribute('data-color', next);
  document.querySelectorAll('button[data-color]').forEach((x) => {
    x.setAttribute('aria-pressed', String(x.dataset.color === next));
  });
  try { localStorage.setItem(COLOR_KEY, next); } catch (e) {}
}

export function zoomAt(clientX, factor) {
  const klines = barsForChart();
  const total = klines.length;
  if (total < 2) return;
  const view = chartSlice(klines);
  const svg = $('chart');
  const box = svg.getBoundingClientRect();
  const mx = (clientX - box.left) / box.width * W;
  const plotW = W - PAD.l - PAD.r;
  const xPlot = Math.min(1, Math.max(0, (mx - PAD.l) / plotW));
  const pivot = view.start + xPlot * Math.max(0, view.count - 1);
  const nextCount = Math.min(maxViewCount(total), Math.max(MIN_BARS, Math.round(view.count * factor)));
  let newStart = Math.round(pivot - xPlot * Math.max(0, nextCount - 1));
  newStart = Math.max(0, Math.min(total - 1, newStart));
  if (state.followLive) applyView(nextCount, liveEndFor(total, nextCount), total);
  else applyView(nextCount, newStart + nextCount, total);
  drawChart(klines, state.ticker, state.hover);
  updateZoomLabel();
  refreshCrosshair();
}

export function endDrag() {
  if (!state.drag) return;
  const wrap = $('chartWrap');
  try { wrap.releasePointerCapture(state.drag.id); } catch (err) {}
  state.drag = null;
  wrap.classList.remove('is-drag');
  refreshCrosshair();
}
