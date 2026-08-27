import { n } from '../core/format.js';
import { FAC_ITEMS, FAC_KEY, factorOn } from '../judge/factors.js';
import { barsForChart } from '../net/rest.js';
import { $, state } from '../state.js';
import { closeBollStyleMenu, closeIndMenu } from './indicator-menu.js';
import { wrap } from '../view/chart.js';
import { renderHeavy } from '../view/panels.js';

export function loadFac() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAC_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return;
    FAC_ITEMS.forEach((x) => {
      if (typeof raw[x.k] === 'boolean') state.fac[x.k] = raw[x.k];
    });
  } catch (e) { /* 沿用默认 */ }
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
