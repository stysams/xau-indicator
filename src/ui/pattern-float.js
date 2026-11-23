import { px } from '../core/format.js';
import { getPatternPlan, normalizePatternMode } from '../indicators/pattern.js';
import { loadMain } from '../net/loader.js';
import { barsForChart } from '../net/rest.js';
import { $, state } from '../state.js';
import { drawChart } from '../view/chart.js';
import { refreshAfterInd, saveInd } from './indicator-menu.js';

export const PATTERN_POS_KEY = 'gold-minute-pattern-pos';

export function loadPatternPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(PATTERN_POS_KEY) || 'null');
    if (raw && typeof raw.x === 'number' && typeof raw.y === 'number' && isFinite(raw.x) && isFinite(raw.y)) {
      state.patternPos = { x: raw.x, y: raw.y };
    }
  } catch (e) { /* 用默认位置 */ }
}

export function savePatternPos() {
  try {
    if (!state.patternPos) localStorage.removeItem(PATTERN_POS_KEY);
    else localStorage.setItem(PATTERN_POS_KEY, JSON.stringify(state.patternPos));
  } catch (e) {}
}

export function clampPatternPos(x, y) {
  const box = $('patternBox');
  const pad = 8;
  const w = (box && !box.hidden && box.offsetWidth) || 320;
  const h = (box && !box.hidden && box.offsetHeight) || 290;
  const maxX = Math.max(pad, window.innerWidth - w - pad);
  const maxY = Math.max(pad, window.innerHeight - h - pad);
  return {
    x: Math.round(Math.min(maxX, Math.max(pad, x))),
    y: Math.round(Math.min(maxY, Math.max(pad, y))),
  };
}

export function defaultPatternPos() {
  const box = $('patternBox');
  const w = (box && !box.hidden && box.offsetWidth) || 320;
  const h = (box && !box.hidden && box.offsetHeight) || 290;
  const pad = 16;
  const wrap = document.querySelector('.chart-wrap');
  if (wrap) {
    const r = wrap.getBoundingClientRect();
    // 默认贴主图右下角（与示例图一致，同时避开左上角 fastBox）
    const x = Math.round(r.right - w - 74);
    const y = Math.round(r.bottom - h - 28);
    return clampPatternPos(x, y);
  }
  return clampPatternPos(window.innerWidth - w - pad, window.innerHeight - h - pad);
}

export function applyPatternPos(persist) {
  const box = $('patternBox');
  if (!box || box.hidden) return;
  if (window.matchMedia('(max-width: 768px)').matches) {
    box.style.removeProperty('left');
    box.style.removeProperty('top');
    box.style.removeProperty('right');
    box.style.removeProperty('bottom');
    box.classList.add('is-placed');
    return;
  }
  const next = state.patternPos ? clampPatternPos(state.patternPos.x, state.patternPos.y) : defaultPatternPos();
  if (state.patternPos) state.patternPos = next;
  box.style.left = next.x + 'px';
  box.style.top = next.y + 'px';
  box.style.right = 'auto';
  box.style.bottom = 'auto';
  box.classList.add('is-placed');
  if (persist) savePatternPos();
}

export function setPatternPos(x, y, persist) {
  state.patternPos = clampPatternPos(x, y);
  applyPatternPos(persist);
}

function endPatternDrag(e) {
  if (!state.patternDrag) return;
  if (e && state.patternDrag.id != null && e.pointerId != null && e.pointerId !== state.patternDrag.id) return;
  const drag = state.patternDrag;
  state.patternDrag = null;
  const box = $('patternBox');
  const handle = $('patternDrag');
  try { if (handle && drag.id != null) handle.releasePointerCapture(drag.id); } catch (err) {}
  if (box) box.classList.remove('is-dragging');
  document.body.classList.remove('is-float-drag');
  savePatternPos();
}

function syncPatternFoldUi() {
  const box = $('patternBox');
  const btn = $('btnPatternFold');
  const folded = !!state.patternCollapsed;
  if (box) box.classList.toggle('is-folded', folded);
  if (btn) {
    btn.setAttribute('aria-expanded', String(!folded));
    btn.textContent = folded ? '展开' : '收起';
  }
}

export function renderPatternPanel(klines, ticker) {
  const box = $('patternBox');
  if (!box) return;
  if (!state.ind.pattern) {
    box.hidden = true;
    box.classList.remove('is-placed');
    return;
  }
  box.hidden = false;
  syncPatternFoldUi();

  const pack = getPatternPlan(klines || state.klines || [], ticker !== undefined ? ticker : state.ticker);
  const active = pack.active;
  const watch = !active ? pack.watch : null;
  const curMode = normalizePatternMode(state.patternMode);
  const isXaudz = curMode === 'xaudz';
  document.querySelectorAll('button[data-pattern-mode]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.patternMode === curMode));
  });
  const orderEl = $('patOrder');
  const sessEl = $('patSession');
  const trendEl = $('patTrend');
  const patEl = $('patName');
  const entryEl = $('patEntry');
  const slEl = $('patSl');
  const tpEl = $('patTp');
  const multEl = $('patMult');
  const pnlEl = $('patPnl');
  const winRateEl = $('patWinRate');
  const winRateLabelEl = $('patWinRateLabel');
  const rfEl = $('patRf');
  const rfLabelEl = $('patRfLabel');

  box.classList.remove('is-long', 'is-short', 'is-flat');
  if (active) box.classList.add(active.dir > 0 ? 'is-long' : 'is-short');
  else box.classList.add('is-flat');

  if (orderEl) {
    if (active) {
      const isLong = active.dir > 0;
      orderEl.className = 'pat-val ' + (isLong ? 'is-up' : 'is-dn');
      orderEl.innerHTML = '<i class="pat-dot ' + (isLong ? 'up' : 'dn') + '" aria-hidden="true"></i>' +
        (isLong ? '多头订单' : '空头订单');
    } else if (pack.forming) {
      const isLong = pack.forming.dir > 0;
      orderEl.className = 'pat-val is-warn';
      orderEl.innerHTML = '<i class="pat-dot warn" aria-hidden="true"></i>' +
        (isLong ? '预备多单' : '预备空单');
    } else if (watch) {
      const isLong = watch.dir > 0;
      const lab = watch.kind === 'rev'
        ? (isLong ? '极值低多参考' : '极值高空参考')
        : (isLong ? '待回踩做多' : '待反抽做空');
      orderEl.className = 'pat-val is-warn';
      orderEl.innerHTML = '<i class="pat-dot warn" aria-hidden="true"></i>' + lab;
    } else {
      orderEl.className = 'pat-val is-muted';
      orderEl.innerHTML = '<i class="pat-dot flat" aria-hidden="true"></i>观望中';
    }
  }

  if (sessEl) {
    sessEl.textContent = (pack.session && pack.session.name) || '亚盘';
  }

  if (trendEl) {
    trendEl.textContent = pack.trendLab || (isXaudz ? '--' : '震荡整理');
    trendEl.className = 'pat-val ' + (pack.trendDir > 0 ? 'is-up' : (pack.trendDir < 0 ? 'is-dn' : 'is-muted'));
  }

  if (patEl) {
    if (active && active.pattern) {
      patEl.textContent = active.pattern.name;
      patEl.className = 'pat-val ' + (active.dir > 0 ? 'is-up' : 'is-dn');
    } else if (pack.forming) {
      patEl.textContent = pack.forming.name + '（形成中）';
      patEl.className = 'pat-val is-warn';
    } else {
      patEl.textContent = '等待形态';
      patEl.className = 'pat-val is-muted';
    }
  }

  const planLv = active || watch;
  if (entryEl) {
    entryEl.textContent = planLv ? ((watch ? '参考 ' : '') + px(planLv.entry)) : '--';
  }

  if (slEl) {
    if (active) {
      slEl.textContent = px(active.sl) + (active.breakeven ? '（已保本）' : '');
      slEl.className = 'pat-val num ' + (active.breakeven ? 'is-up' : 'is-dn');
    } else if (watch) {
      slEl.textContent = px(watch.sl);
      slEl.className = 'pat-val num is-dn';
    } else {
      slEl.textContent = '--';
      slEl.className = 'pat-val num is-dn';
    }
  }

  if (tpEl) {
    if (planLv) {
      const tp1Cls = active && active.hitTp1 ? 'pat-tp-hit' : '';
      tpEl.innerHTML =
        '<span class="pat-tp-item ' + tp1Cls + '">🎯 TP1: ' + px(planLv.tp1) + '</span>' +
        '<span class="pat-tp-sep">|</span>' +
        '<span class="pat-tp-item">🎯 TP2: ' + px(planLv.tp2) + '</span>';
    } else {
      tpEl.textContent = '--';
    }
  }

  if (multEl) {
    multEl.textContent = pack.multText || (isXaudz ? '--' : 'SL×1.8 | TP1×1.35 | TP2×4');
  }

  if (winRateLabelEl) winRateLabelEl.textContent = isXaudz ? '近端 TP1 达标率' : '近端胜率';
  if (winRateEl) {
    const st = pack.stats;
    if (st && st.total > 0 && st.winRate != null) {
      const pct = Math.round(st.winRate * 100);
      winRateEl.textContent = pct + '% (' + st.wins + '/' + st.total + ')';
      winRateEl.className = 'pat-val num ' + (pct >= 55 ? 'is-up' : (pct < 45 ? 'is-dn' : 'is-amber'));
    } else {
      winRateEl.textContent = '暂无已平';
      winRateEl.className = 'pat-val num is-muted';
    }
  }

  if (pnlEl) {
    if (active && pack.pnlPct != null && pack.pnlPts != null) {
      const pct = pack.pnlPct;
      const pts = pack.pnlPts;
      const nearZero = Math.abs(pct) < 0.005;
      pnlEl.className = 'pat-val num ' + (pts > 0 ? 'is-up' : (pts < 0 ? 'is-dn' : 'is-up'));
      if (nearZero) {
        pnlEl.textContent = '0%';
      } else {
        const sign = pct > 0 ? '+' : '';
        const ptSign = pts > 0 ? '+' : '';
        pnlEl.textContent = sign + pct.toFixed(2) + '% (' + ptSign + px(pts) + ')';
      }
    } else {
      pnlEl.className = 'pat-val num is-muted';
      pnlEl.textContent = '0%';
    }
  }

  if (rfLabelEl) {
    rfLabelEl.textContent = isXaudz ? '反推版状态' : 'RF 信号';
  }
  if (rfEl) {
    rfEl.textContent = isXaudz ? (pack.rfSignal || pack.label || '观望等待') : (pack.rfSignal || '观望等待');
    rfEl.title = isXaudz ? (pack.why || '') : '';
    rfEl.className = 'pat-val ' + (
      active && active.hitTp1 ? 'is-up'
        : (pack.forming ? 'is-warn' : 'is-muted')
    );
  }

  if (!state.patternDrag) applyPatternPos(false);
}

let recalcTimer = 0;

export function recalcPatternPlan(opts) {
  opts = opts || {};
  state._patternKey = '';
  state._pattern = null;
  state.chartScale = null;
  const klines = barsForChart();
  drawChart(klines, state.ticker, state.hover);
  renderPatternPanel(klines, state.ticker);

  const btn = $('btnPatternRecalc');
  const finishFeedback = () => {
    if (!btn) return;
    btn.classList.remove('is-busy');
    btn.classList.add('is-done');
    btn.textContent = '已算';
    if (recalcTimer) clearTimeout(recalcTimer);
    recalcTimer = setTimeout(() => {
      btn.classList.remove('is-done');
      btn.textContent = '重算';
      recalcTimer = 0;
    }, 700);
  };

  if (opts.fetch !== false && !state.paused) {
    if (btn) {
      btn.classList.remove('is-done');
      btn.classList.add('is-busy');
      btn.textContent = '重算中';
    }
    Promise.resolve(loadMain()).finally(() => {
      state._patternKey = '';
      state._pattern = null;
      const latest = barsForChart();
      drawChart(latest, state.ticker, state.hover);
      renderPatternPanel(latest, state.ticker);
      finishFeedback();
    });
  } else {
    finishFeedback();
  }
}

export function bindPatternFloat() {
  const box = $('patternBox');
  const handle = $('patternDrag');
  const recalcBtn = $('btnPatternRecalc');
  const foldBtn = $('btnPatternFold');
  const closeBtn = $('btnPatternClose');

  if (recalcBtn) {
    recalcBtn.addEventListener('click', () => {
      recalcPatternPlan({ fetch: true });
    });
  }

  document.querySelectorAll('button[data-pattern-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = normalizePatternMode(btn.dataset.patternMode);
      if (state.patternMode === next) return;
      state.patternMode = next;
      saveInd();
      recalcPatternPlan({ fetch: false });
    });
  });

  if (foldBtn) {
    foldBtn.addEventListener('click', () => {
      state.patternCollapsed = !state.patternCollapsed;
      syncPatternFoldUi();
      if (!state.patternDrag) applyPatternPos(false);
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (!state.ind.pattern) return;
      state.ind.pattern = false;
      refreshAfterInd('pattern');
    });
  }

  if (handle && box) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (window.matchMedia('(max-width: 768px)').matches) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      const r = box.getBoundingClientRect();
      state.patternDrag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      box.classList.add('is-dragging');
      document.body.classList.add('is-float-drag');
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });
    handle.addEventListener('pointermove', (e) => {
      if (!state.patternDrag || e.pointerId !== state.patternDrag.id) return;
      setPatternPos(e.clientX - state.patternDrag.dx, e.clientY - state.patternDrag.dy, false);
    });
    handle.addEventListener('pointerup', endPatternDrag);
    handle.addEventListener('pointercancel', endPatternDrag);
    handle.addEventListener('dblclick', (e) => {
      if (window.matchMedia('(max-width: 768px)').matches) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      state.patternPos = null;
      applyPatternPos(true);
    });
  }

  window.addEventListener('resize', () => {
    if (state.patternDrag) return;
    applyPatternPos(false);
  });
  applyPatternPos(false);
}
