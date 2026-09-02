import { $, state } from '../state.js';
import { applyBiasPane, saveBiasPane } from './bias-pane.js';
import { IND_KEYS, applyBollCssVars, saveInd, syncIndButtons } from './indicator-menu.js';
import { applySessChrome, sessRailOn, setSessRailOn } from './session-rail.js';
import { renderSigChrome } from '../view/signal-rail.js';
import { normalizeAverageLines } from '../indicators/moving-average.js';

export const LAYOUT_KEY = 'gold-minute-layout';

const ALL_OFF = Object.fromEntries(IND_KEYS.map((k) => [k, false]));

export const LAYOUT_PRESETS = {
  standard: {
    id: 'standard',
    lab: '标准盯盘',
    tip: '左侧判断 + 多周期 + 开盘时段 + 时间信号线',
    biasCollapsed: false,
    showMtf: true,
    showSess: true,
    sigRail: true,
    ind: null,
  },
  naked: {
    id: 'naked',
    lab: '裸K专注',
    tip: '收起左侧与多周期，主图只留现价与信号线',
    biasCollapsed: true,
    showMtf: false,
    showSess: false,
    sigRail: true,
    ind: Object.assign({}, ALL_OFF, { last: true }),
    averageLines: [],
  },
  structure: {
    id: 'structure',
    lab: '布林+SMC',
    tip: '打开布林、SMC、支压、企稳与现价，便于看结构',
    biasCollapsed: false,
    showMtf: true,
    showSess: true,
    sigRail: true,
    ind: Object.assign({}, ALL_OFF, {
      boll: true, boll2: true, smc: true, sr: true, hold: true, last: true,
    }),
    averageLines: [],
  },
  fast: {
    id: 'fast',
    lab: '开单跟单',
    tip: '打开开单、1分EMA9、布林主轨与时间信号线',
    biasCollapsed: false,
    showMtf: true,
    showSess: true,
    sigRail: true,
    ind: Object.assign({}, ALL_OFF, {
      fast: true, boll: true, boll2: true, last: true,
    }),
    averageLines: [{ kind: 'ema', period: 9, tf: '1m' }],
  },
};

function blankChrome() {
  return {
    biasCollapsed: !!state.biasCollapsed,
    showMtf: state.showMtf !== false,
    showSess: sessRailOn(),
    sigRail: state.sigRail !== false,
    ind: Object.assign({}, state.ind),
    averageLines: normalizeAverageLines(state.averageLines),
  };
}

export function loadLayoutPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return;
    if (typeof raw.sigRail === 'boolean') state.sigRail = raw.sigRail;
    if (typeof raw.showMtf === 'boolean') state.showMtf = raw.showMtf;
    if (typeof raw.showSess === 'boolean') state.showSess = raw.showSess;
    if (typeof raw.active === 'string') state.layoutId = raw.active;
    if (raw.custom && typeof raw.custom === 'object') state.layoutCustom = raw.custom;
  } catch (e) {}
  if (state.sigRail == null) state.sigRail = true;
  if (state.showMtf == null) state.showMtf = true;
  if (state.showSess == null) state.showSess = true;
}

export function saveLayoutPrefs() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({
      active: state.layoutId || '',
      sigRail: !!state.sigRail,
      showMtf: state.showMtf !== false,
      showSess: state.showSess !== false,
      custom: state.layoutCustom || null,
    }));
  } catch (e) {}
}

export function applyLayoutChrome() {
  const desk = $('desk');
  const mtf = $('mtf');
  const quote = document.querySelector('.quote-bar');
  if (mtf) mtf.hidden = state.showMtf === false;
  if (quote) quote.classList.toggle('is-mtf-off', state.showMtf === false);
  if (desk) desk.classList.toggle('is-mtf-off', state.showMtf === false);
  applySessChrome();
  renderSigChrome();
  syncLayoutButtons();
}

export function applyLayoutPreset(id, opts) {
  opts = opts || {};
  let pack = LAYOUT_PRESETS[id];
  if (id === 'custom' && state.layoutCustom) {
    pack = Object.assign({ id: 'custom', lab: '我的布局' }, state.layoutCustom);
  }
  if (!pack) return false;

  state.layoutId = pack.id;
  if (typeof pack.biasCollapsed === 'boolean') {
    state.biasCollapsed = pack.biasCollapsed;
    saveBiasPane();
    applyBiasPane();
  }
  if (typeof pack.showMtf === 'boolean') state.showMtf = pack.showMtf;
  if (typeof pack.showSess === 'boolean') setSessRailOn(!!pack.showSess);
  if (typeof pack.sigRail === 'boolean') state.sigRail = pack.sigRail;

  if (pack.ind && typeof pack.ind === 'object') {
    IND_KEYS.forEach((k) => {
      if (typeof pack.ind[k] === 'boolean') state.ind[k] = pack.ind[k];
    });
    if (state.ind.boll && !state.ind.boll1 && !state.ind.boll2 && !state.ind.boll3) {
      state.ind.boll2 = true;
    }
    saveInd();
    applyBollCssVars();
    syncIndButtons();
  }
  if (Array.isArray(pack.averageLines)) {
    state.averageLines = normalizeAverageLines(pack.averageLines);
    saveInd();
    syncIndButtons();
  }

  applyLayoutChrome();
  saveLayoutPrefs();
  if (typeof opts.after === 'function') opts.after();
  return true;
}

export function saveCurrentAsCustom() {
  state.layoutCustom = blankChrome();
  state.layoutId = 'custom';
  saveLayoutPrefs();
  syncLayoutButtons();
}

export function toggleSigRail(after) {
  state.sigRail = !state.sigRail;
  if (state.layoutId && state.layoutId !== 'custom') state.layoutId = '';
  saveLayoutPrefs();
  renderSigChrome();
  syncLayoutButtons();
  if (typeof after === 'function') after();
}

export function setLayoutMenu(open) {
  const menu = $('layoutMenu');
  const btn = $('btnLayout');
  const wrap = $('layoutMore');
  if (!menu || !btn) return;
  const next = !!open;
  menu.hidden = !next;
  btn.setAttribute('aria-expanded', String(next));
  if (wrap) wrap.classList.toggle('is-open', next);
}

export function closeLayoutMenu() { setLayoutMenu(false); }

export function toggleLayoutMenu() {
  const menu = $('layoutMenu');
  setLayoutMenu(!!(menu && menu.hidden));
}

export function syncLayoutButtons() {
  const btn = $('btnLayout');
  if (btn) {
    const pack = LAYOUT_PRESETS[state.layoutId] || (state.layoutId === 'custom' ? { lab: '我的布局' } : null);
    btn.title = pack ? ('当前布局：' + pack.lab) : '布局预设';
    btn.setAttribute('aria-pressed', String(!!state.layoutId));
  }
  document.querySelectorAll('[data-layout]').forEach((b) => {
    const id = b.dataset.layout;
    const on = id === state.layoutId || (id === 'custom' && state.layoutId === 'custom');
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-checked', String(on));
  });
  const customBtn = document.querySelector('[data-layout="custom"]');
  if (customBtn) customBtn.disabled = !state.layoutCustom && state.layoutId !== 'custom';
  const saveBtn = $('btnLayoutSave');
  if (saveBtn) saveBtn.setAttribute('aria-pressed', String(state.layoutId === 'custom'));
}

export function bindLayoutPreset(onApply) {
  loadLayoutPrefs();
  applyLayoutChrome();

  const btn = $('btnLayout');
  const menu = $('layoutMenu');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLayoutMenu();
    });
  }
  if (menu) {
    menu.addEventListener('click', (e) => e.stopPropagation());
    menu.querySelectorAll('[data-layout]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.layout;
        if (id === 'custom' && !state.layoutCustom) return;
        applyLayoutPreset(id, { after: onApply });
        closeLayoutMenu();
      });
    });
  }
  const saveBtn = $('btnLayoutSave');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveCurrentAsCustom();
      closeLayoutMenu();
      if (typeof onApply === 'function') onApply();
    });
  }
  const sigBtn = $('btnSigRail');
  if (sigBtn) {
    sigBtn.addEventListener('click', () => toggleSigRail(onApply));
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest || !t.closest('#layoutMore')) closeLayoutMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLayoutMenu();
  });
}
