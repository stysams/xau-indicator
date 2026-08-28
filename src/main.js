import { barsClosedAsOf } from './core/bars.js';
import { fmtClock, n } from './core/format.js';
import { rsi, rsiSeries } from './core/math.js';
import { fmtBj, fmtRange, fromZoned, sessSnapshot, venueState } from './core/session.js';
import { getFib } from './indicators/fib.js';
import { getHkld } from './indicators/hkld.js';
import { getHold } from './indicators/hold.js';
import { getBox } from './indicators/box.js';
import { getSmc } from './indicators/smc.js';
import { getSr } from './indicators/sr.js';
import { getStack } from './indicators/stack.js';
import { getSuperTrend } from './indicators/supertrend.js';
import { getTrap } from './indicators/trap.js';
import { FAC_ITEMS, factorOn } from './judge/factors.js';
import { judge } from './judge/judge.js';
import { mtfLean } from './judge/votes.js';
import { loadMain, loadMtf, loadSession } from './net/loader.js';
import { barsForChart, parseKlines, parseStreamName, parseTicker } from './net/rest.js';
import { connectWs, startPing, stopPing } from './net/ws.js';
import { $, LIVE_ANCHOR, PAD, W, mkt, state } from './state.js';
import { evalFastSetup, loadFast, refresh10sTail, spreadTooWide, stepFastTrade } from './trade/fast.js';
import { bindSimUi, loadSim, renderSimLiveBtn, simLastPrice, tickSimTrade } from './trade/sim.js';
import { bindBiasPane } from './ui/bias-pane.js';
import { applyColor, endDrag, switchMarket, syncMarketChrome, zoomAt } from './ui/chrome.js';
import { bindFacDrag, bindFacMenu, buildFacMenu, closeFacMenu, loadFac, refreshAfterFac, syncFacButtons } from './ui/factor-menu.js';
import { bindFastFloat, loadFastPos } from './ui/fast-float.js';
import { IND_KEYS, applyBollCssVars, closeBollStyleMenu, closeIndMenu, defaultBollStyle, indMenuItems, loadInd, onBollStyleChange, parseHexColor, refreshAfterInd, resetBollStyle, saveInd, setIndMenu, syncIndButtons, toggleBollStyleMenu, toggleIndMenu } from './ui/indicator-menu.js';
import { bindLayoutPreset, closeLayoutMenu } from './ui/layout-preset.js';
import { bindSessRail, tickSess } from './ui/session-rail.js';
import { drawChart, hideCrosshair, showTip, wrap } from './view/chart.js';
import { oscLayout } from './view/osc.js';
import { banner, remainText, render, renderHeavy, renderQuote } from './view/panels.js';
import { bindSignalRail, collectSignalEvents } from './view/signal-rail.js';
import { openSignalView, renderFastPanel } from './view/trade-overlay.js';
import { applyView, chartSlice, resetZoom, updateZoomLabel } from './view/viewport.js';

FAC_ITEMS.forEach((x) => { state.fac[x.k] = true; });
loadFac();

loadInd();
applyBollCssVars();
loadFastPos();

loadSim();

// BOLL20 仅作动态轨参照，不并入静态支压的触碰/强度；下列候选供 bands 图层使用
// 上下轨和中轨作为动态价格区域候选，再与摆动点候选合并。

// 保留开盘时间 <= t 的 K（含正在形成的那根）；与 barsClosedAsOf 语义相反

// 平仓 / 盯市：多头卖在 bid，空头买回在 ask
// 开仓成交：多头买在 ask，空头卖在 bid

// 快开：入场用收盘，盈亏扣往返点差；手工：开平已走买卖价，不再二次扣点差

document.querySelectorAll('[data-tf]').forEach((b) => {
  b.addEventListener('click', () => {
    state.tf = b.dataset.tf;
    document.querySelectorAll('[data-tf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    resetZoom();
    hideCrosshair();
    loadMain();
  });
});
document.querySelectorAll('[data-n]').forEach((b) => {
  b.addEventListener('click', () => {
    state.limit = Number(b.dataset.n);
    document.querySelectorAll('[data-n]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    resetZoom();
    loadMain();
  });
});
document.querySelectorAll('[data-ind]').forEach((b) => {
  b.addEventListener('click', () => {
    const key = b.dataset.ind;
    state.ind[key] = !state.ind[key];
    if (key === 'boll' && state.ind.boll && !state.ind.boll1 && !state.ind.boll2 && !state.ind.boll3) {
      state.ind.boll2 = true;
    }
    refreshAfterInd(key);
  });
});
const btnIndMore = $('btnIndMore');
if (btnIndMore) {
  btnIndMore.addEventListener('click', (e) => {
    e.stopPropagation();
    closeFacMenu();
    closeBollStyleMenu();
    toggleIndMenu();
  });
  btnIndMore.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    setIndMenu(true);
    const first = indMenuItems()[0];
    if (first) first.focus();
  });
}
const indMoreMenu = $('indMoreMenu');
if (indMoreMenu) {
  indMoreMenu.addEventListener('keydown', (e) => {
    const items = indMenuItems();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeIndMenu();
      if (btnIndMore) btnIndMore.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1 + items.length) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    }
  });
  indMoreMenu.addEventListener('click', (e) => e.stopPropagation());
}
const indMore = $('indMore');
if (indMore) {
  indMore.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!indMore.contains(document.activeElement)) closeIndMenu();
    }, 0);
  });
}
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !t.closest || !t.closest('#indMore')) closeIndMenu();
  if (!t || !t.closest || !t.closest('#facMore')) closeFacMenu();
  if (!t || !t.closest || !t.closest('#layoutMore')) closeLayoutMenu();
  if (state._bollColorOpen) return;
  if (!t || !t.closest || !t.closest('#bollStyleWrap')) closeBollStyleMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeIndMenu();
  closeFacMenu();
  closeBollStyleMenu();
  closeLayoutMenu();
});
document.querySelectorAll('button[data-boll-n]').forEach((b) => {
  b.addEventListener('click', () => {
    state.bollN = Number(b.dataset.bollN);
    saveInd();
    syncIndButtons();
    state.chartScale = null;
    state._bmKey = '';
    state._hkldKey = '';
    const klines = barsForChart();
    drawChart(klines, state.ticker, state.hover);
    renderHeavy(klines);
  });
});
document.querySelectorAll('button[data-boll-k]').forEach((b) => {
  b.addEventListener('click', () => {
    state.bollK = Number(b.dataset.bollK);
    saveInd();
    syncIndButtons();
    state.chartScale = null;
    state._bmKey = '';
    state._hkldKey = '';
    const klines = barsForChart();
    drawChart(klines, state.ticker, state.hover);
    renderHeavy(klines);
  });
});
document.querySelectorAll('[data-boll-track]').forEach((row) => {
  const n = Number(row.dataset.bollTrack);
  row.querySelectorAll('[data-boll-line]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!state.bollStyle[n]) state.bollStyle[n] = defaultBollStyle()[n];
      state.bollStyle[n].dash = b.dataset.bollLine === 'dash';
      onBollStyleChange();
    });
  });
  const lineInp = row.querySelector('input[data-boll-color="line"]');
  const fillInp = row.querySelector('input[data-boll-color="fill"]');
  if (lineInp) {
    lineInp.addEventListener('input', () => {
      const hex = parseHexColor(lineInp.value);
      if (!hex) return;
      if (!state.bollStyle[n]) state.bollStyle[n] = defaultBollStyle()[n];
      state.bollStyle[n].line = hex;
      onBollStyleChange();
    });
  }
  if (fillInp) {
    fillInp.addEventListener('input', () => {
      const hex = parseHexColor(fillInp.value);
      if (!hex) return;
      if (!state.bollStyle[n]) state.bollStyle[n] = defaultBollStyle()[n];
      state.bollStyle[n].fill = hex;
      state.bollStyle[n].fillOn = true;
      onBollStyleChange();
    });
  }
  const tog = row.querySelector('[data-boll-fill-tog]');
  if (tog) {
    tog.addEventListener('click', () => {
      if (!state.bollStyle[n]) state.bollStyle[n] = defaultBollStyle()[n];
      state.bollStyle[n].fillOn = !state.bollStyle[n].fillOn;
      onBollStyleChange();
    });
  }
});
const btnBollStyle = $('btnBollStyle');
if (btnBollStyle) {
  btnBollStyle.addEventListener('click', (e) => {
    e.stopPropagation();
    closeIndMenu();
    closeFacMenu();
    toggleBollStyleMenu();
  });
}
const bollStylePanel = $('bollStylePanel');
if (bollStylePanel) {
  bollStylePanel.addEventListener('click', (e) => e.stopPropagation());
  bollStylePanel.querySelectorAll('input[type="color"]').forEach((inp) => {
    inp.addEventListener('focus', () => { state._bollColorOpen = true; });
    inp.addEventListener('blur', () => {
      setTimeout(() => { state._bollColorOpen = false; }, 280);
    });
  });
}
const btnBollStyleReset = $('btnBollStyleReset');
if (btnBollStyleReset) {
  btnBollStyleReset.addEventListener('click', (e) => {
    e.stopPropagation();
    resetBollStyle();
  });
}
document.querySelectorAll('button[data-rsi-n]').forEach((b) => {
  b.addEventListener('click', () => {
    state.rsiN = Number(b.dataset.rsiN);
    saveInd();
    syncIndButtons();
    buildFacMenu();
    syncFacButtons();
    state.chartScale = null;
    state._hkldKey = '';
    const klines = barsForChart();
    drawChart(klines, state.ticker, state.hover);
    renderHeavy(klines);
  });
});
function onStParamChange() {
  saveInd();
  syncIndButtons();
  state.chartScale = null;
  state._stKey = '';
  const klines = barsForChart();
  drawChart(klines, state.ticker, state.hover);
  renderHeavy(klines);
}
document.querySelectorAll('button[data-st-n]').forEach((b) => {
  b.addEventListener('click', () => {
    state.stN = Number(b.dataset.stN);
    onStParamChange();
  });
});
document.querySelectorAll('button[data-st-k]').forEach((b) => {
  b.addEventListener('click', () => {
    state.stK = Number(b.dataset.stK);
    onStParamChange();
  });
});
document.querySelectorAll('button[data-box-len]').forEach((b) => {
  b.addEventListener('click', () => {
    state.boxLen = Number(b.dataset.boxLen);
    saveInd();
    syncIndButtons();
    state.chartScale = null;
    state._boxKey = '';
    const klines = barsForChart();
    drawChart(klines, state.ticker, state.hover);
    renderHeavy(klines);
  });
});
syncIndButtons();

applyColor(document.documentElement.getAttribute('data-color') === 'cn' ? 'cn' : 'us');
document.querySelectorAll('button[data-color]').forEach((b) => {
  b.addEventListener('click', () => applyColor(b.dataset.color));
});
document.querySelectorAll('[data-mkt]').forEach((b) => {
  b.addEventListener('click', () => switchMarket(b.dataset.mkt));
});

$('btnRefresh').addEventListener('click', () => { loadMain(); loadMtf(); loadFast(); });
$('btnPause').addEventListener('click', () => {
  state.paused = !state.paused;
  $('btnPause').setAttribute('aria-pressed', String(state.paused));
  $('btnPause').textContent = state.paused ? '继续' : '暂停';
  if (state.paused) {
    stopPing();
  } else {
    loadMain();
    if (!state.wsOk) connectWs();
    else startPing();
  }
  renderQuote();
});

if (window.ResizeObserver && wrap) {
  let chartResizeRaf = 0;
  new ResizeObserver(() => {
    if (chartResizeRaf) return;
    chartResizeRaf = requestAnimationFrame(() => {
      chartResizeRaf = 0;
      const k = barsForChart();
      if (k && k.length) drawChart(k, state.ticker, state.hover);
    });
  }).observe(wrap);
}
wrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  const intensity = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomAt(e.clientX, Math.exp(intensity * 0.0024));
}, { passive: false });

wrap.addEventListener('dblclick', (e) => {
  e.preventDefault();
  resetZoom();
  state.hover = -1;
  $('tip').classList.remove('show');
  hideCrosshair();
  drawChart(barsForChart(), state.ticker, -1);
  updateZoomLabel();
});

wrap.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const view = chartSlice(barsForChart());
  state.drag = { x: e.clientX, end: view.end, count: view.count, n: view.n, id: e.pointerId, moved: false };
  try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
});
wrap.addEventListener('pointermove', (e) => {
  state.pointer = { clientX: e.clientX, clientY: e.clientY };
  if (state.drag) {
    const dx = e.clientX - state.drag.x;
    if (!state.drag.moved && Math.abs(dx) < 5) return;
    state.drag.moved = true;
    wrap.classList.add('is-drag');
    $('tip').classList.remove('show');
    hideCrosshair();
    state.hover = -1;
    const box = $('chart').getBoundingClientRect();
    const plotW = W - PAD.l - PAD.r;
    const dxBars = (dx / box.width * W) / plotW * state.drag.count;
    applyView(state.drag.count, state.drag.end - dxBars, state.drag.n);
    drawChart(barsForChart(), state.ticker, -1);
    updateZoomLabel();
    return;
  }
  const k = barsForChart();
  if (k.length) showTip(e, k);
});
wrap.addEventListener('pointerup', endDrag);
wrap.addEventListener('pointercancel', endDrag);
wrap.addEventListener('pointerleave', () => {
  if (state.drag) return;
  state.hover = -1;
  state.pointer = null;
  $('tip').classList.remove('show');
  hideCrosshair();
  drawChart(barsForChart(), state.ticker, -1);
});

$('btnZoomReset').addEventListener('click', () => {
  resetZoom();
  drawChart(barsForChart(), state.ticker, -1);
  updateZoomLabel();
});

document.addEventListener('keydown', (e) => {
  const dlg = $('simDlg');
  if (dlg && dlg.open) return;
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); loadMain(); loadMtf(); loadFast(); }
  if (e.key === ' ') {
    if (e.target && /input|button|summary|textarea/i.test(e.target.tagName)) return;
    e.preventDefault();
    $('btnPause').click();
  }
  if (e.key === '+' || e.key === '=') {
    const box = $('chart').getBoundingClientRect();
    const plot = (W - PAD.l - PAD.r) / W;
    zoomAt(box.left + box.width * (PAD.l / W + LIVE_ANCHOR * plot), 0.85);
  }
  if (e.key === '-' || e.key === '_') {
    const box = $('chart').getBoundingClientRect();
    const plot = (W - PAD.l - PAD.r) / W;
    zoomAt(box.left + box.width * (PAD.l / W + LIVE_ANCHOR * plot), 1.18);
  }
  if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
    resetZoom();
    drawChart(barsForChart(), state.ticker, -1);
    updateZoomLabel();
  }
});

if (location.protocol === 'file:') {
  banner('不能用文件方式打开。请在本目录运行 node serve.js，再访问 http://127.0.0.1:8787', true);
}

bindSimUi();

bindBiasPane();
bindFacMenu();
bindFacDrag();
bindSessRail();
bindFastFloat();

function refreshAfterLayout() {
  state.chartScale = null;
  const klines = barsForChart();
  drawChart(klines, state.ticker, state.hover);
  renderHeavy(klines);
  renderFastPanel();
}

bindLayoutPreset(refreshAfterLayout);
bindSignalRail((i) => {
  const klines = barsForChart();
  if (!klines.length) return;
  const view = chartSlice(klines);
  const half = Math.floor(view.count / 2);
  state.viewEnd = Math.min(klines.length, Math.max(view.count, i + 1 + half));
  state.followLive = state.viewEnd >= klines.length;
  state.chartScale = null;
  drawChart(klines, state.ticker, -1);
  updateZoomLabel();
});

window.__goldTest = {
  mkt: () => mkt(),
  switchMarket: (id) => switchMarket(id),
  sessAt: (ms) => sessSnapshot(Number(ms) || Date.now()),
  sessVenue: (id, ms) => venueState(id, Number(ms) || Date.now()),
  fromZoned: (tz, y, mo, d, h, mi, s) => fromZoned(tz, y, mo, d, h, mi, s),
  fmtBj: (ms) => fmtBj(Number(ms)),
  fmtRange: (a, b) => fmtRange(a, b),
  tickSess: (ms) => tickSess(Number(ms) || Date.now()),
  parseTicker: (raw) => parseTicker(raw),
  parseKlines: (raw) => parseKlines(raw),
  parseStreamName: (name) => parseStreamName(name),
  getTrap: (kl) => getTrap(kl || state.klines),
  getHold: (kl) => getHold(kl || state.klines),
  getSr: (kl) => getSr(kl || state.klines),
  getSmc: (kl) => getSmc(kl || state.klines),
  getStack: () => getStack(),
  getHkld: (kl) => getHkld(kl || state.klines),
  getFib: (kl) => getFib(kl || state.klines),
  getSuperTrend: (kl) => getSuperTrend(kl || state.klines),
  getBox: (kl) => getBox(kl || state.klines),
  judge: (kl) => judge(kl || state.klines, state.ticker, state.mtf),
  evalFastSetup: (bars, ticker, preview) => evalFastSetup(bars, ticker, preview),
  mtfLean: (kl) => mtfLean(kl),
  spreadTooWide: (spread, tpDist) => spreadTooWide(spread, tpDist),
  openSignalView: () => openSignalView(),
  applyKlines: (klines, tf) => {
    state.reqId += 1;
    state.paused = true;
    if (state.ws) {
      try { state.ws.onclose = null; state.ws.close(); } catch (e) {}
      state.ws = null;
    }
    state.wsOk = true;
    if (tf) state.tf = tf;
    state.mtf = {};
    state.klines = klines;
    const last = klines && klines[klines.length - 1];
    if (last) {
      let hi = -Infinity, lo = Infinity;
      klines.forEach((k) => {
        hi = Math.max(hi, k.h);
        lo = Math.min(lo, k.l);
      });
      state.ticker = Object.assign({}, state.ticker || {}, {
        last: last.c, bid: last.c, ask: last.c, high: hi, low: lo,
      });
    }
    state._trapKey = '';
    state._holdKey = '';
    state._pbKey = '';
    state._srKey = '';
    state._hsKey = '';
    state._smcKey = '';
    state._bmKey = '';
    state._stackKey = '';
    state._hkldKey = '';
    state._fibKey = '';
    state._stKey = '';
    state._boxKey = '';
    state.viewCount = null;
    state.viewEnd = null;
    state.followLive = true;
    state.chartScale = null;
    render();
    const used = barsForChart();
    return {
      trap: getTrap(used),
      hold: getHold(used),
      smc: getSmc(used),
      stack: getStack(),
      hkld: getHkld(used),
      fib: getFib(used),
      st: getSuperTrend(used),
      box: getBox(used),
      judge: judge(used, state.ticker, state.mtf),
    };
  },
  applyHkld: (pack) => {
    pack = pack || {};
    const tf = pack.tf || '1m';
    const klines = pack.klines || pack['1m'] || [];
    window.__goldTest.applyKlines(klines, tf);
    state.mtf = Object.assign({}, state.mtf, {
      '1m': pack['1m'] || klines,
      '5m': pack['5m'] || [],
      '15m': pack['15m'] || [],
      '1h': pack['1h'] || [],
    });
    state._hkldKey = '';
    render();
    const used = barsForChart();
    return {
      hkld: getHkld(used),
      judge: judge(used, state.ticker, state.mtf),
    };
  },
  applyStack: (pack) => {
    pack = pack || {};
    const tf = pack.tf || '1m';
    const klines = pack.klines || pack['1m'] || [];
    window.__goldTest.applyKlines(klines, tf);
    state.mtf = Object.assign({}, state.mtf, {
      '1m': pack['1m'] || klines,
      '5m': pack['5m'] || [],
      '15m': pack['15m'] || [],
      '1h': pack['1h'] || [],
    });
    state._stackKey = '';
    render();
    const used = barsForChart();
    return {
      stack: getStack(),
      judge: judge(used, state.ticker, state.mtf),
    };
  },
  factorOn: (k) => factorOn(k),
  rsiSeries: (closes, period) => rsiSeries(closes, period),
  oscLayout: () => oscLayout(),
  setInd: (k, on) => {
    if (k === '*') {
      IND_KEYS.forEach((key) => { state.ind[key] = !!on; });
      if (on) {
        state.ind.boll1 = false;
        state.ind.boll2 = true;
        state.ind.boll3 = false;
      }
      refreshAfterInd('rsi');
      if (on) renderFastPanel();
      return true;
    }
    if (!k || !(k in state.ind)) return false;
    state.ind[k] = !!on;
    if (k === 'boll' && state.ind.boll && !state.ind.boll1 && !state.ind.boll2 && !state.ind.boll3) {
      state.ind.boll2 = true;
    }
    refreshAfterInd(k);
    return !!state.ind[k];
  },
  setFac: (k, on) => {
    if (!k || !(k in state.fac)) return false;
    state.fac[k] = !!on;
    refreshAfterFac();
    return factorOn(k);
  },
  collectSignals: (kl) => collectSignalEvents(kl || barsForChart()),
  pushFastMark: (t, dir) => {
    state.fastMarks = (state.fastMarks || []).concat([{ t: Number(t), dir: Number(dir) || 1 }]).slice(-12);
    state.chartScale = null;
    render();
    return state.fastMarks.length;
  },
};

syncMarketChrome();
loadMain();
loadMtf();
loadFast();
connectWs();
setInterval(() => { if (!state.paused && !state.wsOk) loadMain(); }, 2000);
setInterval(() => { if (!state.paused) loadSession(); }, 60000);
setInterval(() => { if (!state.paused) loadMtf(); }, 45000);
setInterval(() => { if (!state.paused) refresh10sTail(); }, 8000);
setInterval(() => {
  $('clock').textContent = fmtClock();
  if (state.ticker) $('remain').textContent = remainText(state.ticker.closeTime);
  tickSess(Date.now());
  if (state.fastTrade && state.fastTrade.status === 'open') {
    stepFastTrade(Date.now(), state.ticker || {});
    renderFastPanel();
  } else if (state.fastLast && Date.now() - state.fastLast.exitAt < 13000) {
    renderFastPanel();
  }
  const last = simLastPrice();
  if (last != null) tickSimTrade(last);
  else renderSimLiveBtn();
}, 1000);

