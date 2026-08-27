import { px } from '../core/format.js';
import { $, state } from '../state.js';
import { applyFastPos } from './fast-float.js';

export const BIAS_KEY = 'gold-minute-bias';

export const BIAS_MIN = 200;

export function isDeskNarrow() {
  return window.matchMedia('(max-width: 768px)').matches;
}

export function biasMaxW() {
  const desk = $('desk');
  const w = desk ? desk.clientWidth : 1100;
  return Math.max(BIAS_MIN + 24, Math.min(Math.round(w * 0.48), w - 380));
}

export function defaultBiasW() {
  const desk = $('desk');
  const w = desk ? desk.clientWidth : 1100;
  return Math.round(Math.min(biasMaxW(), Math.max(BIAS_MIN, w * 0.18)));
}

export function saveBiasPane() {
  try {
    localStorage.setItem(BIAS_KEY, JSON.stringify({
      w: state.biasW,
      collapsed: !!state.biasCollapsed,
    }));
  } catch (e) {}
}

export function applyBiasPane() {
  const desk = $('desk');
  const body = $('biasBody');
  const btn = $('btnBiasFold');
  const resizer = $('biasResizer');
  if (!desk) return;
  const on = !!state.biasCollapsed;
  const narrow = isDeskNarrow();
  desk.classList.toggle('is-bias-collapsed', on);
  if (narrow) {
    desk.style.removeProperty('--bias-w');
  } else if (!on) {
    const w = Math.round(Math.min(biasMaxW(), Math.max(BIAS_MIN, state.biasW || defaultBiasW())));
    state.biasW = w;
    desk.style.setProperty('--bias-w', w + 'px');
  }
  if (body) body.hidden = on;
  if (btn) {
    btn.setAttribute('aria-expanded', String(!on));
    const lab = on ? '展开左侧栏' : '折叠左侧栏';
    btn.setAttribute('aria-label', lab);
    btn.title = lab;
  }
  if (resizer) {
    const w = state.biasW || defaultBiasW();
    const max = biasMaxW();
    resizer.hidden = narrow || on;
    resizer.disabled = narrow || on;
    resizer.setAttribute('aria-valuemin', String(BIAS_MIN));
    resizer.setAttribute('aria-valuemax', String(max));
    resizer.setAttribute('aria-valuenow', String(w));
    resizer.setAttribute('aria-valuetext', w + ' 像素');
  }
  if (!state.fastPos && !state.fastDrag) applyFastPos(false);
}

export function setBiasWidth(px, persist) {
  const w = Math.round(Math.min(biasMaxW(), Math.max(BIAS_MIN, px)));
  state.biasW = w;
  const desk = $('desk');
  if (desk && !isDeskNarrow() && !state.biasCollapsed) {
    desk.style.setProperty('--bias-w', w + 'px');
  }
  const resizer = $('biasResizer');
  if (resizer) {
    resizer.setAttribute('aria-valuenow', String(w));
    resizer.setAttribute('aria-valuetext', w + ' 像素');
  }
  if (persist) saveBiasPane();
  if (!state.fastPos && !state.fastDrag) applyFastPos(false);
}

export function onBiasMove(e) {
  if (!state.biasDrag) return;
  if (state.biasDrag.id != null && e.pointerId != null && e.pointerId !== state.biasDrag.id) return;
  setBiasWidth(state.biasDrag.startW + (e.clientX - state.biasDrag.startX), false);
}

export function endBiasDrag(e) {
  if (!state.biasDrag) return;
  if (e && state.biasDrag.id != null && e.pointerId != null && e.pointerId !== state.biasDrag.id) return;
  const drag = state.biasDrag;
  state.biasDrag = null;
  const resizer = $('biasResizer');
  const desk = $('desk');
  try { if (resizer && drag.id != null) resizer.releasePointerCapture(drag.id); } catch (err) {}
  window.removeEventListener('pointermove', onBiasMove);
  window.removeEventListener('pointerup', endBiasDrag);
  window.removeEventListener('pointercancel', endBiasDrag);
  if (desk) desk.classList.remove('is-resizing');
  document.body.classList.remove('is-col-resize');
  saveBiasPane();
}

export function bindBiasPane() {
  try {
    const raw = JSON.parse(localStorage.getItem(BIAS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.w === 'number' && isFinite(raw.w)) state.biasW = raw.w;
      if (typeof raw.collapsed === 'boolean') state.biasCollapsed = raw.collapsed;
    }
  } catch (e) {}
  if (state.biasW == null) state.biasW = defaultBiasW();
  applyBiasPane();
  const btn = $('btnBiasFold');
  const resizer = $('biasResizer');
  const desk = $('desk');
  const card = $('biasCard');
  if (btn) {
    btn.addEventListener('click', () => {
      state.biasCollapsed = !state.biasCollapsed;
      applyBiasPane();
      saveBiasPane();
    });
  }
  if (card) {
    card.addEventListener('click', (e) => {
      if (!state.biasCollapsed) return;
      if (e.target && e.target.closest && (e.target.closest('#btnBiasFold') || e.target.closest('#facMore'))) return;
      state.biasCollapsed = false;
      applyBiasPane();
      saveBiasPane();
    });
  }
  if (resizer) {
    resizer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (state.biasCollapsed || isDeskNarrow()) return;
      e.preventDefault();
      const startW = state.biasW || ($('biasCard') ? $('biasCard').getBoundingClientRect().width : defaultBiasW());
      state.biasDrag = { id: e.pointerId, startX: e.clientX, startW: startW };
      if (desk) desk.classList.add('is-resizing');
      document.body.classList.add('is-col-resize');
      window.addEventListener('pointermove', onBiasMove);
      window.addEventListener('pointerup', endBiasDrag);
      window.addEventListener('pointercancel', endBiasDrag);
      try { resizer.setPointerCapture(e.pointerId); } catch (err) {}
    });
    resizer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      state.biasCollapsed = false;
      setBiasWidth(defaultBiasW(), false);
      applyBiasPane();
      saveBiasPane();
    });
    resizer.addEventListener('keydown', (e) => {
      if (state.biasCollapsed || isDeskNarrow()) return;
      const step = e.shiftKey ? 48 : 16;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setBiasWidth((state.biasW || defaultBiasW()) - step, true); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setBiasWidth((state.biasW || defaultBiasW()) + step, true); }
      if (e.key === 'Home') { e.preventDefault(); setBiasWidth(BIAS_MIN, true); }
      if (e.key === 'End') { e.preventDefault(); setBiasWidth(biasMaxW(), true); }
    });
  }
  window.addEventListener('resize', () => {
    if (!state.biasCollapsed && !isDeskNarrow()) {
      setBiasWidth(state.biasW || defaultBiasW(), false);
    }
    applyBiasPane();
  });
}
