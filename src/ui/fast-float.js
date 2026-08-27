import { $, state } from '../state.js';
import { refreshAfterInd, saveInd, syncIndButtons } from './indicator-menu.js';
import { wrap } from '../view/chart.js';

export const FAST_POS_KEY = 'gold-minute-fast-pos';

export function loadFastPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAST_POS_KEY) || 'null');
    if (raw && typeof raw.x === 'number' && typeof raw.y === 'number' && isFinite(raw.x) && isFinite(raw.y)) {
      state.fastPos = { x: raw.x, y: raw.y };
    }
  } catch (e) { /* 用默认位置 */ }
}

export function saveFastPos() {
  try {
    if (!state.fastPos) localStorage.removeItem(FAST_POS_KEY);
    else localStorage.setItem(FAST_POS_KEY, JSON.stringify(state.fastPos));
  } catch (e) {}
}

export function clampFastPos(x, y) {
  const box = $('fastBox');
  const pad = 8;
  const w = (box && !box.hidden && box.offsetWidth) || 280;
  const h = (box && !box.hidden && box.offsetHeight) || 220;
  const maxX = Math.max(pad, window.innerWidth - w - pad);
  const maxY = Math.max(pad, window.innerHeight - h - pad);
  return {
    x: Math.round(Math.min(maxX, Math.max(pad, x))),
    y: Math.round(Math.min(maxY, Math.max(pad, y))),
  };
}

export function defaultFastPos() {
  const box = $('fastBox');
  const w = (box && !box.hidden && box.offsetWidth) || 280;
  const pad = 12;
  const wrap = document.querySelector('.chart-wrap');
  if (wrap) {
    const r = wrap.getBoundingClientRect();
    const x = window.matchMedia('(max-width: 768px)').matches
      ? pad
      : Math.round(r.left + pad);
    return clampFastPos(x, Math.round(r.top + pad));
  }
  const quote = document.querySelector('.quote-bar');
  const y = quote ? Math.round(quote.getBoundingClientRect().bottom + pad) : 88;
  const bias = $('biasCard');
  const x = bias && !window.matchMedia('(max-width: 768px)').matches
    ? Math.round(bias.getBoundingClientRect().right + pad)
    : Math.round(window.innerWidth - w - pad);
  return clampFastPos(x, y);
}

export function applyFastPos(persist) {
  const box = $('fastBox');
  if (!box || box.hidden) return;
  const next = state.fastPos ? clampFastPos(state.fastPos.x, state.fastPos.y) : defaultFastPos();
  if (state.fastPos) state.fastPos = next;
  box.style.left = next.x + 'px';
  box.style.top = next.y + 'px';
  box.style.right = 'auto';
  box.style.bottom = 'auto';
  box.classList.add('is-placed');
  if (persist) saveFastPos();
}

export function setFastPos(x, y, persist) {
  state.fastPos = clampFastPos(x, y);
  applyFastPos(persist);
}

export function endFastDrag(e) {
  if (!state.fastDrag) return;
  if (e && state.fastDrag.id != null && e.pointerId != null && e.pointerId !== state.fastDrag.id) return;
  const drag = state.fastDrag;
  state.fastDrag = null;
  const box = $('fastBox');
  const handle = $('fastDrag');
  try { if (handle && drag.id != null) handle.releasePointerCapture(drag.id); } catch (err) {}
  if (box) box.classList.remove('is-dragging');
  document.body.classList.remove('is-float-drag');
  saveFastPos();
}

export function bindFastFloat() {
  const box = $('fastBox');
  const handle = $('fastDrag');
  const beepBtn = $('btnFastBeep');
  const closeBtn = $('btnFastClose');
  if (beepBtn) {
    beepBtn.addEventListener('click', () => {
      state.fastBeep = !state.fastBeep;
      saveInd();
      syncIndButtons();
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (!state.ind.fast) return;
      state.ind.fast = false;
      refreshAfterInd('fast');
    });
  }
  if (handle && box) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      const r = box.getBoundingClientRect();
      state.fastDrag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      box.classList.add('is-dragging');
      document.body.classList.add('is-float-drag');
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });
    handle.addEventListener('pointermove', (e) => {
      if (!state.fastDrag || e.pointerId !== state.fastDrag.id) return;
      setFastPos(e.clientX - state.fastDrag.dx, e.clientY - state.fastDrag.dy, false);
    });
    handle.addEventListener('pointerup', endFastDrag);
    handle.addEventListener('pointercancel', endFastDrag);
    handle.addEventListener('dblclick', (e) => {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      state.fastPos = null;
      applyFastPos(true);
    });
  }
  window.addEventListener('resize', () => {
    if (state.fastDrag) return;
    applyFastPos(false);
  });
  applyFastPos(false);
}
