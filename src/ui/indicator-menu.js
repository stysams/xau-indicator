import { n } from '../core/format.js';
import { rsi } from '../core/math.js';
import { barsForChart } from '../net/rest.js';
import { $, state } from '../state.js';
import { applyFastPos } from './fast-float.js';
import { drawChart, wrap } from '../view/chart.js';
import { renderBollStatus, renderBoxStatus, renderHeavy, renderStState, renderStackBar } from '../view/panels.js';
import { renderFastPanel } from '../view/trade-overlay.js';

export const IND_KEY = 'gold-minute-ind';

export const IND_KEYS = ['ema9', 'ema21', 'boll', 'smc', 'smcSig', 'stack', 'hkld', 'fib', 'hs', 'sr', 'bounce', 'pull', 'trap', 'hold', 'last', 'hl', 'boll1', 'boll2', 'boll3', 'macd', 'rsi', 'usidx', 'vwap', 'fast', 'st', 'box'];

export const IND_MORE = [
  { k: 'hl', lab: '高低' },
  { k: 'bounce', lab: '反弹' },
  { k: 'pull', lab: '回踩' },
  { k: 'trap', lab: '诱空诱多' },
  { k: 'hold', lab: '企稳' },
  { k: 'smcSig', lab: 'SMC多空' },
  { k: 'stack', lab: '套轨' },
  { k: 'hkld', lab: '高空低多' },
  { k: 'box', lab: '箱体震荡' },
  { k: 'fib', lab: '斐波那契' },
  { k: 'st', lab: '超级趋势' },
  { k: 'vwap', lab: '日内均价' },
  { k: 'ema9', lab: 'EMA9' },
  { k: 'ema21', lab: 'EMA21' },
];

export const SR_MODES = ['normal', 'swing', 'pressure'];

export function normalizeSrMode(v) {
  return SR_MODES.indexOf(v) >= 0 ? v : 'normal';
}

export const ST_PERIODS = [7, 10, 14];

export const ST_MULTS = [2, 2.5, 3];

export const BOX_LENS = [60, 120, 180];

export function parseHexColor(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return '';
}

export function defaultBollStyle() {
  return {
    1: { dash: true, line: '#4a8f8d', fill: '#4a8f8d', fillOn: false },
    2: { dash: true, line: '#176c6b', fill: '#176c6b', fillOn: true },
    3: { dash: true, line: '#6b7d7c', fill: '#6b7d7c', fillOn: false },
  };
}

export function readBollStyle(raw) {
  const next = defaultBollStyle();
  if (!raw || typeof raw !== 'object') return next;
  [1, 2, 3].forEach((n) => {
    const row = raw[n] || raw[String(n)];
    if (!row || typeof row !== 'object') return;
    if (typeof row.dash === 'boolean') next[n].dash = row.dash;
    const line = parseHexColor(row.line);
    const fill = parseHexColor(row.fill);
    if (line) next[n].line = line;
    if (fill) next[n].fill = fill;
    if (typeof row.fillOn === 'boolean') next[n].fillOn = row.fillOn;
  });
  return next;
}

export function bollSt(n) {
  const d = defaultBollStyle()[n];
  const cur = state.bollStyle && state.bollStyle[n];
  if (!cur) return d;
  return {
    dash: !!cur.dash,
    line: parseHexColor(cur.line) || d.line,
    fill: parseHexColor(cur.fill) || d.fill,
    fillOn: !!cur.fillOn,
  };
}

export function bollDash(n) {
  if (!bollSt(n).dash) return '';
  return n === 1 ? '2 2' : n === 3 ? '5 4' : '3 3';
}

export function resetBollStyle() {
  state.bollStyle = defaultBollStyle();
  onBollStyleChange();
}

export function applyBollCssVars() {
  document.documentElement.style.setProperty('--boll', bollSt(2).line);
}

export function syncBollStyleUi() {
  applyBollCssVars();
  document.querySelectorAll('[data-boll-track]').forEach((row) => {
    const n = Number(row.dataset.bollTrack);
    const st = bollSt(n);
    const on = n === 1 ? !!state.ind.boll1 : n === 3 ? !!state.ind.boll3 : !!state.ind.boll2;
    row.classList.toggle('is-off', !on);
    row.style.setProperty('--track-line', st.line);
    row.querySelectorAll('[data-boll-line]').forEach((b) => {
      b.setAttribute('aria-pressed', String((b.dataset.bollLine === 'dash') === !!st.dash));
    });
    const lineInp = row.querySelector('input[data-boll-color="line"]');
    const fillInp = row.querySelector('input[data-boll-color="fill"]');
    if (lineInp) lineInp.value = st.line;
    if (fillInp) fillInp.value = st.fill;
    const lineSw = row.querySelector('[data-boll-swatch="line"]');
    const fillSw = row.querySelector('[data-boll-swatch="fill"]');
    if (lineSw) lineSw.style.background = st.line;
    if (fillSw) {
      fillSw.style.background = st.fillOn ? st.fill : 'transparent';
      const face = fillSw.parentElement;
      if (face) face.classList.toggle('is-off', !st.fillOn);
    }
    const tog = row.querySelector('[data-boll-fill-tog]');
    if (tog) tog.setAttribute('aria-pressed', String(!!st.fillOn));
  });
  document.querySelectorAll('[data-boll-chip]').forEach((el) => {
    const n = Number(el.dataset.bollChip);
    el.style.background = bollSt(n).line;
  });
}

export function loadInd() {
  try {
    const raw = JSON.parse(localStorage.getItem(IND_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return;
    IND_KEYS.forEach((k) => {
      if (typeof raw[k] === 'boolean') state.ind[k] = raw[k];
    });
    if (raw.bollN === 10 || raw.bollN === 20 || raw.bollN === 30) state.bollN = raw.bollN;
    if (raw.bollK === 1.5 || raw.bollK === 2 || raw.bollK === 2.5) state.bollK = raw.bollK;
    if (typeof raw.srMode === 'string') state.srMode = normalizeSrMode(raw.srMode);
    else if (raw.srSwing === true) state.srMode = 'swing';
    if (raw.rsiN === 6 || raw.rsiN === 9 || raw.rsiN === 14) state.rsiN = raw.rsiN;
    if (ST_PERIODS.indexOf(raw.stN) >= 0) state.stN = raw.stN;
    if (ST_MULTS.indexOf(raw.stK) >= 0) state.stK = raw.stK;
    if (BOX_LENS.indexOf(raw.boxLen) >= 0) state.boxLen = raw.boxLen;
    if (typeof raw.fastBeep === 'boolean') state.fastBeep = raw.fastBeep;
    state.bollStyle = readBollStyle(raw.bollStyle);
  } catch (e) { /* 沿用默认 */ }
}

export function saveInd() {
  try {
    localStorage.setItem(IND_KEY, JSON.stringify(Object.assign({}, state.ind, {
      bollN: state.bollN, bollK: state.bollK, rsiN: state.rsiN, fastBeep: state.fastBeep,
      stN: state.stN, stK: state.stK, boxLen: state.boxLen,
      srMode: state.srMode,
      bollStyle: state.bollStyle,
    })));
  } catch (e) {}
}

export function syncIndButtons() {
  document.querySelectorAll('[data-ind]').forEach((b) => {
    const on = !!state.ind[b.dataset.ind];
    b.setAttribute('aria-pressed', String(on));
    if (b.getAttribute('role') === 'menuitemcheckbox') b.setAttribute('aria-checked', String(on));
  });
  document.querySelectorAll('[data-leg]').forEach((el) => {
    el.hidden = !state.ind[el.dataset.leg];
  });
  const bar = $('bollBar');
  const st = $('bollStatus');
  if (bar) bar.hidden = !state.ind.boll;
  if (st) st.hidden = !state.ind.boll;
  if (!state.ind.boll) closeBollStyleMenu();
  syncBollStyleUi();
  const stackEl = $('stackBar');
  if (stackEl) stackEl.hidden = !state.ind.stack;
  document.querySelectorAll('button[data-boll-n]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.bollN) === state.bollN));
  });
  document.querySelectorAll('button[data-boll-k]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.bollK) === state.bollK));
  });
  const rsiBar = $('rsiBar');
  if (rsiBar) rsiBar.hidden = !state.ind.rsi;
  const usidxBar = $('usidxBar');
  if (usidxBar) usidxBar.hidden = !state.ind.usidx;
  document.querySelectorAll('button[data-rsi-n]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.rsiN) === state.rsiN));
  });
  const stBar = $('stBar');
  if (stBar) stBar.hidden = !state.ind.st;
  document.querySelectorAll('button[data-st-n]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.stN) === state.stN));
  });
  document.querySelectorAll('button[data-st-k]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.stK) === state.stK));
  });
  const boxBar = $('boxBar');
  if (boxBar) boxBar.hidden = !state.ind.box;
  document.querySelectorAll('button[data-box-len]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.boxLen) === state.boxLen));
  });
  const boxStatus = $('boxStatus');
  if (boxStatus) boxStatus.hidden = !state.ind.box;
  const srBar = $('srBar');
  if (srBar) srBar.hidden = !state.ind.sr;
  document.querySelectorAll('button[data-sr-mode]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.srMode === state.srMode));
  });
  const beep = $('btnFastBeep');
  if (beep) beep.setAttribute('aria-pressed', String(!!state.fastBeep));
  const fastBox = $('fastBox');
  if (fastBox) {
    fastBox.hidden = !state.ind.fast;
    if (!state.ind.fast) fastBox.classList.remove('is-placed');
    else if (!state.fastDrag) applyFastPos(false);
  }
  const caret = $('btnIndMore');
  if (caret) {
    const opened = IND_MORE.filter((x) => !!state.ind[x.k]).map((x) => x.lab);
    caret.setAttribute('aria-pressed', String(opened.length > 0));
    caret.title = opened.length ? ('已开：' + opened.join('、')) : ('更多指标：' + IND_MORE.map((x) => x.lab).join('、'));
  }
}

export function setIndMenu(open) {
  const menu = $('indMoreMenu');
  const caret = $('btnIndMore');
  const wrap = $('indMore');
  if (!menu || !caret) return;
  const next = !!open;
  menu.hidden = !next;
  caret.setAttribute('aria-expanded', String(next));
  if (wrap) wrap.classList.toggle('is-open', next);
}

export function closeIndMenu() { setIndMenu(false); }

export function toggleIndMenu() {
  const menu = $('indMoreMenu');
  setIndMenu(menu ? menu.hidden : true);
}

export function setBollStyleMenu(open) {
  const panel = $('bollStylePanel');
  const btn = $('btnBollStyle');
  const wrap = $('bollStyleWrap');
  if (!panel || !btn) return;
  const next = !!open;
  panel.hidden = !next;
  btn.setAttribute('aria-expanded', String(next));
  if (wrap) wrap.classList.toggle('is-open', next);
}

export function closeBollStyleMenu() { setBollStyleMenu(false); }

export function toggleBollStyleMenu() {
  const panel = $('bollStylePanel');
  setBollStyleMenu(panel ? panel.hidden : true);
}

export function indMenuItems() {
  const menu = $('indMoreMenu');
  return menu ? Array.prototype.slice.call(menu.querySelectorAll('button')) : [];
}

export function refreshAfterInd(key) {
  saveInd();
  syncIndButtons();
  state.chartScale = null;
  state._bmKey = '';
  state._hsKey = '';
  state._srKey = '';
  state._smcKey = '';
  state._pbKey = '';
  state._trapKey = '';
  state._holdKey = '';
  state._stackKey = '';
  state._hkldKey = '';
  state._fibKey = '';
  state._stKey = '';
  state._boxKey = '';
  const klines = barsForChart();
  drawChart(klines, state.ticker, state.hover);
  renderBollStatus(klines);
  renderStackBar();
  renderStState(klines);
  renderBoxStatus(klines);
  if (key === 'fast') renderFastPanel();
  if (key === 'rsi') renderHeavy(klines);
}

export function onBollStyleChange() {
  if (!state.bollStyle) state.bollStyle = defaultBollStyle();
  saveInd();
  syncBollStyleUi();
  state.chartScale = null;
  const klines = barsForChart();
  drawChart(klines, state.ticker, state.hover);
  renderBollStatus(klines);
}
