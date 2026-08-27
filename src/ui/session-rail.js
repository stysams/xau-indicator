import { fmtRange, sessRemain, sessSnapshot } from '../core/session.js';
import { $, mkt, state } from '../state.js';

export const SESS_SHOW_KEY = 'gold-minute-sess-show';

export function sessForGold() { return mkt().id === 'xau'; }

export function sessRailOn() {
  try {
    const raw = localStorage.getItem(SESS_SHOW_KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
  } catch (e) {}
  return true;
}

export function applySessChrome() {
  const gold = sessForGold();
  const btn = $('btnSess');
  const el = $('sessRail');
  if (btn) {
    btn.hidden = !gold;
    btn.setAttribute('aria-pressed', String(gold && sessRailOn()));
  }
  if (!gold) {
    if (el) el.hidden = true;
    return;
  }
  const on = sessRailOn();
  if (el) el.hidden = !on;
  if (on) renderSessRail(Date.now());
}

export function setSessRailOn(on) {
  if (!sessForGold()) return;
  try { localStorage.setItem(SESS_SHOW_KEY, on ? '1' : '0'); } catch (e) {}
  applySessChrome();
}

export function renderSessRail(now) {
  const el = $('sessRail');
  if (!el) return;
  if (!sessForGold() || el.hidden) return;
  const snap = sessSnapshot(now);
  el.innerHTML = '<div class="sess-track">' + snap.items.map(function (x) {
    const cls = 'sess-item' + (x.open ? ' is-open' : '');
    const range = x.start ? fmtRange(x.start, x.end) : '近 10 天无开盘';
    const next = x.open
      ? (range + ' · 还剩 ' + sessRemain(x.end - snap.now))
      : range;
    return '<div class="' + cls + '" title="' + x.hint + '">' +
      '<span class="sess-name">' + x.short + '</span>' +
      '<b class="sess-state">' + x.phase + '</b>' +
      '<span class="sess-next num">' + next + '</span></div>';
  }).join('') + '</div>';
}

export function tickSess(now) {
  renderSessRail(now || Date.now());
}

export function bindSessRail() {
  const btn = $('btnSess');
  applySessChrome();
  if (btn) {
    btn.addEventListener('click', () => {
      if (!sessForGold()) return;
      setSessRailOn(!sessRailOn());
    });
  }
}
