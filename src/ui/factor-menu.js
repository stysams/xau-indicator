import { n } from '../core/format.js';
import { FAC_ITEMS, FAC_KEY, factorOn } from '../judge/factors.js';
import { barsForChart } from '../net/rest.js';
import { $, state } from '../state.js';
import { closeBollStyleMenu, closeIndMenu } from './indicator-menu.js';
import { wrap } from '../view/chart.js';
import { renderHeavy } from '../view/panels.js';

export const FAC_ORDER_KEY = 'gold-minute-fac-order';

export function loadFac() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAC_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return;
    FAC_ITEMS.forEach((x) => {
      if (typeof raw[x.k] === 'boolean') state.fac[x.k] = raw[x.k];
    });
  } catch (e) { /* 沿用默认 */ }
  loadFacOrder();
}

export function loadFacOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAC_ORDER_KEY) || 'null');
    if (Array.isArray(raw)) {
      const valid = raw.filter((id) => FAC_ITEMS.some((x) => x.k === id));
      if (valid.length) state.facOrder = valid;
    }
  } catch (e) { /* 用默认顺序 */ }
}

export function saveFacOrder() {
  try {
    if (state.facOrder && state.facOrder.length) localStorage.setItem(FAC_ORDER_KEY, JSON.stringify(state.facOrder));
    else localStorage.removeItem(FAC_ORDER_KEY);
  } catch (e) {}
}

export function readFacOrderFromDom() {
  const list = $('factors');
  if (!list) return;
  const ids = [];
  list.querySelectorAll('.factor').forEach((el) => {
    const id = el && el.getAttribute('data-fac-id');
    if (id) ids.push(id);
  });
  if (!ids.length) return;
  state.facOrder = ids;
  saveFacOrder();
}

export function bindFacDrag() {
  const list = $('factors');
  if (!list) return;
  let src = null;
  list.addEventListener('dragstart', (e) => {
    const row = e.target && e.target.closest ? e.target.closest('.factor') : null;
    if (!row || !list.contains(row)) return;
    src = row;
    state._facDrag = true;
    list.classList.add('is-dragging');
    row.classList.add('is-dragging');
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.getAttribute('data-fac-id') || '');
    } catch (err) {}
  });
  list.addEventListener('dragover', (e) => {
    if (!src) return;
    e.preventDefault();
    const row = e.target && e.target.closest ? e.target.closest('.factor') : null;
    list.querySelectorAll('.factor.is-drag-over').forEach((el) => el.classList.remove('is-drag-over'));
    if (!row || row === src) return;
    const r = row.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) {
      if (row.previousElementSibling !== src) list.insertBefore(src, row);
    } else {
      if (row.nextElementSibling !== src) list.insertBefore(src, row.nextElementSibling);
    }
    row.classList.add('is-drag-over');
  });
  const end = () => {
    if (!src) return;
    state._facDrag = false;
    list.classList.remove('is-dragging');
    list.querySelectorAll('.factor.is-dragging, .factor.is-drag-over').forEach((el) => el.classList.remove('is-dragging', 'is-drag-over'));
    readFacOrderFromDom();
    src = null;
  };
  list.addEventListener('dragend', end);
  list.addEventListener('drop', (e) => e.preventDefault());
}

export function saveFac() {
  try { localStorage.setItem(FAC_KEY, JSON.stringify(state.fac)); } catch (e) {}
}

export function facOpenedCount() {
  return FAC_ITEMS.filter((x) => factorOn(x.k)).length;
}

export function syncFacButtons() {
  const n = facOpenedCount();
  document.querySelectorAll('[data-fac]').forEach((b) => {
    const on = factorOn(b.dataset.fac);
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('aria-pressed', String(on));
  });
  const caret = $('btnFacMore');
  if (caret) {
    caret.classList.toggle('is-partial', n < FAC_ITEMS.length);
    caret.title = n === FAC_ITEMS.length
      ? '勾选判断因子，不影响主图指标'
      : ('已开 ' + n + ' / ' + FAC_ITEMS.length + ' 项因子，不影响主图指标');
  }
}

export function setFacMenu(open) {
  const menu = $('facMoreMenu');
  const caret = $('btnFacMore');
  const wrap = $('facMore');
  const card = $('biasCard');
  if (!menu || !caret) return;
  const next = !!open;
  menu.hidden = !next;
  caret.setAttribute('aria-expanded', String(next));
  if (wrap) wrap.classList.toggle('is-open', next);
  if (card) card.classList.toggle('is-fac-open', next);
}

export function closeFacMenu() { setFacMenu(false); }

export function toggleFacMenu() {
  const menu = $('facMoreMenu');
  setFacMenu(menu ? menu.hidden : true);
}

export function facMenuItems() {
  const menu = $('facMoreMenu');
  return menu ? Array.prototype.slice.call(menu.querySelectorAll('button')) : [];
}

export function facLab(x) {
  if (x.k === 'rsi') return 'RSI' + (state.rsiN || 14);
  return x.lab;
}

export function buildFacMenu() {
  const menu = $('facMoreMenu');
  if (!menu) return;
  menu.innerHTML = FAC_ITEMS.map((x) => (
    '<button type="button" role="menuitemcheckbox" data-fac="' + x.k +
    '" aria-checked="true" aria-pressed="true"><i class="fac-check" aria-hidden="true"></i>' +
    facLab(x) + '</button>'
  )).join('');
}

export function refreshAfterFac() {
  saveFac();
  syncFacButtons();
  state._pbKey = '';
  state._stackKey = '';
  renderHeavy(barsForChart());
}

export function bindFacMenu() {
  buildFacMenu();
  syncFacButtons();
  const btn = $('btnFacMore');
  const menu = $('facMoreMenu');
  const wrap = $('facMore');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeIndMenu();
      closeBollStyleMenu();
      toggleFacMenu();
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      closeIndMenu();
      setFacMenu(true);
      const first = facMenuItems()[0];
      if (first) first.focus();
    });
  }
  if (menu) {
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target && e.target.closest && e.target.closest('[data-fac]');
      if (!b) return;
      const key = b.dataset.fac;
      state.fac[key] = !factorOn(key);
      refreshAfterFac();
    });
    menu.addEventListener('keydown', (e) => {
      const items = facMenuItems();
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFacMenu();
        if (btn) btn.focus();
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
  }
  if (wrap) {
    wrap.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!wrap.contains(document.activeElement)) closeFacMenu();
      }, 0);
    });
  }
}
