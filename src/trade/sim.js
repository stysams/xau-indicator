import { minuteBars } from '../core/bars.js';
import { atrFallback, fmtHms, n, px } from '../core/format.js';
import { atr } from '../core/math.js';
import { judge } from '../judge/judge.js';
import { $, SIM_AUTO_DEFAULTS, SIM_HIST_MAX, mkt, simKey, state } from '../state.js';
import { clampFastDist, closeFastTrade, entryMarkPrice, fastBounds, markPrice, simSourceLabel, spreadOf } from './fast.js';
import { saveInd, syncIndButtons } from '../ui/indicator-menu.js';
import { scheduleChart } from '../view/panels.js';
import { renderFastPanel } from '../view/trade-overlay.js';

export function simPnl(entry, exit, dir, spread) {
  if (entry == null || exit == null || dir == null) return null;
  const gross = (exit - entry) * dir;
  const cost = (spread != null && Number.isFinite(spread) && spread > 0) ? spread : 0;
  return gross - cost;
}

export function fmtUsd(v) {
  if (v == null || !Number.isFinite(v)) return '--';
  return (v > 0 ? '+' : v === 0 ? '' : '') + v.toFixed(2);
}

export function simOpenOrders() {
  return (state.simOrders || []).filter((o) => o.status === 'open');
}

export function simClosedOrders() {
  return (state.simOrders || []).filter((o) => o.status === 'closed');
}

export function clampSimParam(key, value) {
  const rules = {
    tpAtr: [0.5, 3, SIM_AUTO_DEFAULTS.tpAtr],
    slAtr: [0.5, 3, SIM_AUTO_DEFAULTS.slAtr],
    holdSec: [30, 900, SIM_AUTO_DEFAULTS.holdSec],
    coolSec: [0, 300, SIM_AUTO_DEFAULTS.coolSec],
  };
  const rule = rules[key];
  if (!rule) return null;
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : rule[2];
  const v = Math.min(rule[1], Math.max(rule[0], safe));
  return key === 'holdSec' || key === 'coolSec' ? Math.round(v) : Math.round(v * 100) / 100;
}

export function normalizeSimAutoParams(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    tpAtr: clampSimParam('tpAtr', src.tpAtr),
    slAtr: clampSimParam('slAtr', src.slAtr),
    holdSec: clampSimParam('holdSec', src.holdSec),
    coolSec: clampSimParam('coolSec', src.coolSec),
  };
}

export function fastHoldMs() { return (state.simAutoParams.holdSec || SIM_AUTO_DEFAULTS.holdSec) * 1000; }

export function fastCoolMs() { return (state.simAutoParams.coolSec != null ? state.simAutoParams.coolSec : SIM_AUTO_DEFAULTS.coolSec) * 1000; }

export function normalizeSimOrder(raw, fallbackStatus) {
  if (!raw || typeof raw.entry !== 'number') return null;
  const dir = raw.dir === -1 ? -1 : 1;
  const status = raw.status === 'closed' || fallbackStatus === 'closed' ? 'closed' : 'open';
  let pnl = null;
  if (typeof raw.pnl === 'number') pnl = raw.pnl;
  else if (status === 'closed' && raw.exit != null) {
    pnl = simPnl(raw.entry, raw.exit, dir, raw.spread);
  }
  else if (typeof raw.pnlPts === 'number') pnl = raw.pnlPts * 0.01;
  return {
    id: raw.id || ('sim-' + (raw.openAt || Date.now()) + '-' + Math.random().toString(36).slice(2, 6)),
    dir: dir,
    entry: raw.entry,
    exit: status === 'closed' ? (raw.exit != null ? raw.exit : raw.entry) : null,
    pnl: status === 'closed' ? (pnl != null ? pnl : 0) : null,
    status: status,
    openAt: raw.openAt || Date.now(),
    closeAt: raw.closeAt || null,
    tf: raw.tf || state.tf,
    source: raw.source === 'fast' ? 'fast' : 'manual',
    kind: typeof raw.kind === 'string' ? raw.kind : null,
    spread: raw.spread != null && Number.isFinite(raw.spread) && raw.spread > 0 ? raw.spread : null,
  };
}

export function trimSimOrders() {
  const open = simOpenOrders();
  const closed = simClosedOrders().slice(-SIM_HIST_MAX);
  state.simOrders = open.concat(closed);
}

export function loadSim() {
  state.simDir = 1;
  state.simOrders = [];
  state.simLastClose = null;
  state.simAuto = false;
  state.simAutoParams = Object.assign({}, SIM_AUTO_DEFAULTS);
  state.simJudge = null;
  state._closingAll = false;
  try {
    let stored = localStorage.getItem(simKey());
    if (!stored && mkt().id === 'xau') stored = localStorage.getItem('gold-minute-sim');
    const raw = JSON.parse(stored || 'null');
    if (!raw || typeof raw !== 'object') return;
    if (raw.dir === 1 || raw.dir === -1) state.simDir = raw.dir;
    if (typeof raw.auto === 'boolean') state.simAuto = raw.auto;
    if (state.simAuto) state.ind.fast = true;
    state.simAutoParams = normalizeSimAutoParams(raw.autoParams);
    const orders = [];
    if (Array.isArray(raw.orders) && raw.orders.length) {
      raw.orders.forEach((item) => {
        const o = normalizeSimOrder(item);
        if (o) orders.push(o);
      });
    } else {
      if (raw.open && typeof raw.open.entry === 'number') {
        const o = normalizeSimOrder(raw.open, 'open');
        if (o) orders.push(o);
      }
      (raw.hist || []).forEach((item) => {
        const o = normalizeSimOrder(item, 'closed');
        if (o) orders.push(o);
      });
    }
    state.simOrders = orders;
    trimSimOrders();
  } catch (e) { /* 沿用空仓 */ }
}

export function saveSim() {
  try {
    trimSimOrders();
    localStorage.setItem(simKey(), JSON.stringify({
      dir: state.simDir,
      auto: state.simAuto,
      autoParams: state.simAutoParams,
      orders: state.simOrders,
    }));
  } catch (e) {}
}

export function refreshSimUi() {
  renderSimLiveBtn();
  const dlg = $('simDlg');
  if (dlg && dlg.open) renderSimDialog();
}

export function recordFastSimOpen(tr) {
  if (!tr || tr.entry == null) return;
  const o = {
    id: 'fast-' + (tr.entryAt || Date.now()) + '-' + Math.random().toString(36).slice(2, 6),
    source: 'fast',
    dir: tr.dir > 0 ? 1 : -1,
    entry: tr.entry,
    exit: null,
    pnl: null,
    status: 'open',
    openAt: tr.entryAt || Date.now(),
    closeAt: null,
    tf: '10s',
    kind: null,
    spread: tr.spread != null && tr.spread > 0 ? tr.spread : null,
  };
  tr.simId = o.id;
  state.simOrders = (state.simOrders || []).concat([o]);
  saveSim();
  refreshSimUi();
}

export function recordFastSimClose(done, simId) {
  if (!done || done.entry == null || done.exit == null) return;
  const pnl = done.pnl != null ? done.pnl : simPnl(done.entry, done.exit, done.dir, done.spread);
  let o = (state.simOrders || []).find((x) => x.id === simId && x.status === 'open');
  if (!o) {
    o = (state.simOrders || []).find((x) => x.source === 'fast' && x.status === 'open' && x.dir === done.dir && x.entry === done.entry);
  }
  if (!o) {
    o = {
      id: simId || ('fast-' + (done.exitAt || Date.now()) + '-' + Math.random().toString(36).slice(2, 6)),
      source: 'fast',
      dir: done.dir > 0 ? 1 : -1,
      entry: done.entry,
      exit: done.exit,
      pnl: pnl,
      status: 'closed',
      openAt: done.entryAt || Date.now(),
      closeAt: done.exitAt || Date.now(),
      tf: '10s',
      kind: done.status || null,
    };
    state.simOrders = (state.simOrders || []).concat([o]);
  } else {
    o.exit = done.exit;
    o.pnl = pnl;
    o.status = 'closed';
    o.closeAt = done.exitAt || Date.now();
    o.kind = done.status || o.kind;
    o.source = 'fast';
  }
  state.simLastClose = o;
  saveSim();
  refreshSimUi();
}

export function simOrderSpread(o) {
  if (o && o.spread != null && o.spread > 0) return o.spread;
  return spreadOf(state.ticker);
}

export function simMarkExit(o) {
  const marked = markPrice(o.dir, state.ticker);
  if (marked != null) return marked;
  return simLastPrice();
}

export function simOpenPnl(o) {
  const pxNow = simMarkExit(o);
  if (pxNow == null) return null;
  const cost = o.source === 'fast' ? simOrderSpread(o) : null;
  return simPnl(o.entry, pxNow, o.dir, cost);
}

export function simStats() {
  const closed = simClosedOrders();
  const n = closed.length;
  const wins = closed.filter((h) => h.pnl > 0).length;
  const losses = closed.filter((h) => h.pnl < 0).length;
  const sum = closed.reduce((a, h) => a + (h.pnl || 0), 0);
  const opens = simOpenOrders();
  const floating = opens.reduce((a, o) => a + (simOpenPnl(o) || 0), 0);
  const rate = n ? (wins / n) * 100 : null;
  return { n: n, wins: wins, losses: losses, sum: sum, rate: rate, openN: opens.length, floating: floating };
}

export function simLastPrice() {
  const t = state.ticker;
  if (t && t.last != null) return t.last;
  const k = state.klines;
  if (k && k.length) return k[k.length - 1].c;
  return null;
}

export function renderSimKpis() {
  const el = $('simKpis');
  if (!el) return;
  try {
    const s = simStats();
    const parts = [];
    if (s.openN) {
      const fCls = s.floating > 0 ? 'up' : s.floating < 0 ? 'dn' : '';
      parts.push('持仓 <b>' + s.openN + '</b> 浮 <b class="' + fCls + '">' + fmtUsd(s.floating) + '</b>');
    }
    if (!s.n) {
      parts.push(s.openN ? '还没有已平仓' : '还没有订单');
      el.innerHTML = parts.join('  ');
      return;
    }
    const rateCls = s.rate >= 50 ? 'up' : 'dn';
    const sumCls = s.sum > 0 ? 'up' : s.sum < 0 ? 'dn' : '';
    const fastN = simClosedOrders().filter((o) => o.source === 'fast').length;
    parts.push(
      '胜率 <b class="' + rateCls + '">' + s.rate.toFixed(0) + '%</b>',
      '已平 <b>' + s.n + '</b>',
      '胜 <b class="up">' + s.wins + '</b>',
      '负 <b class="dn">' + s.losses + '</b>',
      '合计 <b class="' + sumCls + '">' + fmtUsd(s.sum) + '</b>'
    );
    if (fastN) parts.push('开单 <b>' + fastN + '</b>');
    el.innerHTML = parts.join('  ');
  } catch (e) {
    el.innerHTML = '统计加载中...';
  }
}

export function renderSimOrders() {
  const box = $('simHistBox');
  if (!box) return;
  try {
    const opens = simOpenOrders().slice().reverse();
    const closed = simClosedOrders().slice().reverse();
    let html = '';
    html += '<h3 class="sim-sec">持仓 ' + opens.length + '</h3>';
    if (!opens.length) {
      html += '<p class="sim-empty">当前没有持仓。点开仓会按现价记一笔，开单信号触发后也会出现在这里。</p>';
    } else {
      html += opens.map((o) => {
        const pnl = simOpenPnl(o);
        const cls = pnl > 0 ? 'up' : pnl < 0 ? 'dn' : '';
        const src = o.source === 'fast' ? '<span class="sim-src">开单</span>' : '';
        return '<div class="sim-order">' +
          '<span class="dir ' + (o.dir > 0 ? 'up' : 'dn') + '">' + (o.dir > 0 ? '多' : '空') + src + '</span>' +
          '<span class="num">开 ' + px(o.entry) + '</span>' +
          '<span class="num ' + cls + '" data-sim-pnl="' + o.id + '">' + fmtUsd(pnl) + '</span>' +
          '<button type="button" class="btn" data-sim-close="' + o.id + '">平仓</button>' +
          '</div>';
      }).join('');
    }
    html += '<h3 class="sim-sec">已平 ' + closed.length + '</h3>';
    if (!closed.length) {
      html += '<p class="sim-empty">平仓后出现在这里，记下开仓价、平仓价和盈亏价差，用来统计胜率。</p>';
    } else {
      html += '<table><thead><tr><th>时间</th><th>向</th><th>开仓</th><th>平仓</th><th>盈亏</th><th>说明</th></tr></thead><tbody>' +
        closed.map((h) => {
          const cls = h.pnl > 0 ? 'up' : h.pnl < 0 ? 'dn' : '';
          const t = h.closeAt ? fmtHms(Math.floor(h.closeAt / 1000)) : '--';
          return '<tr>' +
            '<td>' + t + '</td>' +
            '<td>' + (h.dir > 0 ? '多' : '空') + '</td>' +
            '<td>' + px(h.entry) + '</td>' +
            '<td>' + px(h.exit) + '</td>' +
            '<td class="' + cls + '">' + fmtUsd(h.pnl) + '</td>' +
            '<td>' + simSourceLabel(h) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    }
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = '<p class="sim-empty">订单加载中...</p>';
  }
}

export function renderSimLiveBtn() {
  const btn = $('btnSim');
  const live = $('simLive');
  if (!btn || !live) return;
  try {
    const opens = simOpenOrders();
    if (opens.length) {
      const parts = opens.map((o) => simOpenPnl(o));
      const pnl = parts.every((p) => p == null) ? null : parts.reduce((a, p) => a + (p || 0), 0);
      btn.classList.add('holding');
      live.hidden = false;
      live.textContent = opens.length + '笔 ' + (pnl == null ? '持仓' : fmtUsd(pnl));
      live.style.color = pnl > 0 ? 'var(--up)' : pnl < 0 ? 'var(--down)' : '';
      return;
    }
    if (state.simAuto) {
      btn.classList.remove('holding');
      live.hidden = false;
      live.textContent = '自动';
      live.style.color = 'var(--accent)';
      return;
    }
    btn.classList.remove('holding');
    live.hidden = true;
    live.textContent = '';
    live.style.color = '';
  } catch (e) {
    btn.classList.remove('holding');
    live.hidden = true;
    live.textContent = '';
    live.style.color = '';
  }
}

export function setSimMsg(text, kind) {
  const el = $('simMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'sim-msg' + (kind ? ' ' + kind : '');
  // 5秒后自动清除消息，防止残留导致卡住
  if (text) {
    clearTimeout(el._msgTimer);
    el._msgTimer = setTimeout(() => {
      if (el && el.textContent === text) {
        el.textContent = '';
        el.className = 'sim-msg';
      }
    }, 5000);
  }
}

export function syncSimDirButtons() {
  document.querySelectorAll('[data-sim-dir]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.simDir) === state.simDir));
  });
}

export function syncSimAutoUi() {
  const sw = $('simAutoSwitch');
  const status = $('simAutoState');
  if (sw) sw.setAttribute('aria-checked', String(!!state.simAuto));
  if (status) {
    status.textContent = state.simAuto ? '已开启，信号确认后自动建立纸面订单' : '已关闭，只显示开单信号';
    status.classList.toggle('is-on', !!state.simAuto);
  }
  document.querySelectorAll('[data-sim-param]').forEach((input) => {
    const key = input.dataset.simParam;
    const value = state.simAutoParams[key];
    if (document.activeElement !== input && value != null) input.value = String(value);
  });
  const hint = $('simDistHint');
  if (hint) {
    const m1 = minuteBars();
    const a1 = atr(m1, 14);
    const last = m1 && m1.length ? m1[m1.length - 1].c : simLastPrice();
    if (a1 == null || !(a1 > 0) || last == null) {
      hint.textContent = '实际止盈/止损距离会按当前 1 分 ATR 与上下限换算。';
    } else {
      const auto = state.simAutoParams || SIM_AUTO_DEFAULTS;
      const bounds = fastBounds(last);
      const rawTp = auto.tpAtr * a1;
      const rawSl = auto.slAtr * a1;
      const tpDist = clampFastDist(rawTp, bounds.tpMin, bounds.tpMax);
      const slDist = clampFastDist(rawSl, bounds.slMin, bounds.slMax);
      const clamped = (tpDist !== rawTp) || (slDist !== rawSl);
      hint.textContent = '当前 1 分 ATR ' + px(a1, 2) +
        ' · 实际止盈 ' + px(tpDist, 2) +
        ' / 止损 ' + px(slDist, 2) +
        (clamped ? '（已触达上下限）' : '') +
        '。下一笔新单生效。';
    }
  }
}

export function renderSimJudge() {
  const box = $('simJudgeResult');
  if (!box) return;
  box.className = 'sim-judge-result';
  box.replaceChildren();
  const result = state.simJudge;
  if (!result) {
    box.textContent = '读取当前页面全部已加载K线后给出方向';
    return;
  }
  if (result.error) {
    box.classList.add('err');
    box.textContent = result.error;
    return;
  }
  box.classList.add(result.dir > 0 ? 'bull' : 'bear');
  const strong = document.createElement('b');
  strong.textContent = result.label;
  const detail = document.createElement('span');
  detail.textContent = ' · ' + result.detail;
  box.append(strong, detail);
}

export function allKlineSlope(bars) {
  if (!bars || bars.length < 2) return 0;
  const closes = bars.map((bar) => Number(bar.c)).filter(Number.isFinite);
  const n = closes.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = closes.reduce((sum, value) => sum + value, 0) / n;
  let top = 0;
  let bottom = 0;
  closes.forEach((value, index) => {
    const dx = index - xMean;
    top += dx * (value - yMean);
    bottom += dx * dx;
  });
  return bottom ? top / bottom : 0;
}

export function judgeSimDirection() {
  const bars = (state.klines || []).filter((bar) => bar && Number.isFinite(Number(bar.c)));
  if (bars.length < 30) {
    state.simJudge = { error: 'K线样本不足：当前只有' + bars.length + '根，至少需要30根。' };
    renderSimJudge();
    return;
  }
  const result = judge(bars, state.ticker, state.mtf);
  const factors = result && Array.isArray(result.factors) ? result.factors : [];
  const bull = factors.filter((factor) => factor.vote > 0).length;
  const bear = factors.filter((factor) => factor.vote < 0).length;
  let dir = result && result.dir === '偏多' ? 1 : result && result.dir === '偏空' ? -1 : 0;
  let basis = '核心因子一致';
  if (!dir && bull !== bear) {
    dir = bull > bear ? 1 : -1;
    basis = '方向票占优，但核心结构尚未完全一致';
  }
  if (!dir) {
    const slope = allKlineSlope(bars);
    const atrv = atr(bars, 14) || atrFallback(bars[bars.length - 1].c);
    const move = Math.abs(slope) * bars.length;
    if (atrv > 0 && move > atrv * 0.85) {
      dir = slope > 0 ? 1 : -1;
      basis = '方向票持平，全部K线收盘价回归斜率显著（累计位移>' + px(atrv * 0.85, 2) + '）';
    }
  }
  if (!dir) {
    state.simJudge = { error: '全部K线与方向票均持平，当前无法给出可靠的多空方向。' };
    renderSimJudge();
    return;
  }
  state.simDir = dir;
  state.simJudge = {
    dir: dir,
    label: dir > 0 ? '偏多' : '偏空',
    detail: bars.length + '根' + state.tf + 'K线；' + bull + '项偏多，' + bear + '项偏空；' + basis,
  };
  saveSim();
  syncSimDirButtons();
  renderSimJudge();
  setSimMsg('已按当前页面全部K线选择' + (dir > 0 ? '做多' : '做空') + '方向', 'ok');
}

export function syncSimNow(price) {
  const el = $('simNowPx');
  if (el) el.textContent = px(price);
}

export function patchSimFloat(price) {
  syncSimNow(price);
  document.querySelectorAll('[data-sim-pnl]').forEach((el) => {
    const id = el.getAttribute('data-sim-pnl');
    const o = (state.simOrders || []).find((x) => x.id === id && x.status === 'open');
    if (!o) return;
    const pnl = simOpenPnl(o);
    el.textContent = fmtUsd(pnl);
    el.className = 'num ' + (pnl > 0 ? 'up' : pnl < 0 ? 'dn' : '');
  });
  renderSimLiveBtn();
  const dlg = $('simDlg');
  if (dlg && dlg.open) renderSimKpis();
}

export function renderSimDialog() {
  try {
    const closeAll = $('btnSimCloseAll');
    const opens = simOpenOrders();
    if (closeAll) {
      closeAll.disabled = !opens.length || !!state._closingAll;
      closeAll.textContent = opens.length ? '全部平仓' : '无持仓';
    }
    syncSimDirButtons();
    syncSimAutoUi();
    renderSimJudge();
    syncSimNow(simLastPrice());
    renderSimKpis();
    renderSimOrders();
    renderSimLiveBtn();
  } catch (e) {
    const box = $('simHistBox');
    if (box) box.innerHTML = '<p class="sim-empty">渲染异常，请关闭对话框重新打开</p>';
  }
}

export function openSimDialog() {
  const dlg = $('simDlg');
  const btn = $('btnSim');
  if (!dlg) return;
  // 清除残留消息
  setSimMsg('');
  state._closingAll = false;
  renderSimDialog();
  if (dlg.open) return;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  const openBtn = $('btnSimOpen');
  if (openBtn) openBtn.focus();
}

export function closeSimDialog() {
  const dlg = $('simDlg');
  const btn = $('btnSim');
  // 清除残留消息
  setSimMsg('');
  state._closingAll = false;
  if (dlg && dlg.open) dlg.close();
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  }
}

export function openSimTrade() {
  const fill = entryMarkPrice(state.simDir, state.ticker) || simLastPrice();
  if (fill == null) {
    setSimMsg('还没有最新价，等行情到了再开仓', 'err');
    return;
  }
  const spr = spreadOf(state.ticker);
  const o = {
    id: 'sim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    dir: state.simDir,
    entry: fill,
    exit: null,
    pnl: null,
    status: 'open',
    openAt: Date.now(),
    closeAt: null,
    tf: state.tf,
    source: 'manual',
    kind: null,
    spread: spr,
  };
  state.simOrders = state.simOrders.concat([o]);
  saveSim();
  setSimMsg('已开仓 ' + (o.dir > 0 ? '做多' : '做空') + '  ' + px(o.entry), 'ok');
  renderSimDialog();
  state.chartScale = null;
  scheduleChart();
}

export function closeSimTrade(id) {
  const o = (state.simOrders || []).find((x) => x.id === id && x.status === 'open');
  if (!o) {
    setSimMsg('找不到这笔持仓', 'err');
    return false;
  }
  
  if (o.source === 'fast' && state.fastTrade && state.fastTrade.status === 'open' && state.fastTrade.simId === o.id) {
    const exitPx = simMarkExit(o);
    if (exitPx == null) {
      setSimMsg('还没有最新价，等行情到了再平仓', 'err');
      return false;
    }
    closeFastTrade('manual', exitPx, Date.now());
    const updated = (state.simOrders || []).find((x) => x.id === id);
    if (updated) {
      setSimMsg('已平仓开单 ' + (updated.dir > 0 ? '多' : '空') + '  开 ' + px(updated.entry) + '  平 ' + px(updated.exit) + '  ' + fmtUsd(updated.pnl), updated.pnl > 0 ? 'ok' : updated.pnl < 0 ? 'err' : '');
    }
    renderSimDialog();
    return true;
  }
  
  const exitPx = simMarkExit(o);
  if (exitPx == null) {
    setSimMsg('还没有最新价，等行情到了再平仓', 'err');
    return false;
  }
  
  const cost = o.source === 'fast' ? simOrderSpread(o) : null;
  o.exit = exitPx;
  o.pnl = simPnl(o.entry, exitPx, o.dir, cost);
  o.status = 'closed';
  o.closeAt = Date.now();
  if (o.source === 'fast' && !o.kind) o.kind = 'manual';
  saveSim();
  // 平仓成功后只显示简短消息，并自动清除
  setSimMsg('已平仓', 'ok');
  renderSimDialog();
  state.chartScale = null;
  scheduleChart();
  return true;
}

export function closeAllSimTrades() {
  if (state._closingAll) {
    setSimMsg('正在平仓中，请稍候...', '');
    return;
  }
  
  const opens = simOpenOrders();
  if (!opens.length) {
    setSimMsg('当前没有持仓');
    return;
  }
  
  if (opens.some((o) => simMarkExit(o) == null)) {
    setSimMsg('还没有最新价，等行情到了再平仓', 'err');
    return;
  }

  state._closingAll = true;
  const closeAllBtn = $('btnSimCloseAll');
  if (closeAllBtn) closeAllBtn.disabled = true;
  
  try {
    const openIds = opens.map(o => o.id);
    
    const fastOrder = opens.find(o => 
      o.source === 'fast' && 
      state.fastTrade && 
      state.fastTrade.status === 'open' && 
      state.fastTrade.simId === o.id
    );
    
    if (fastOrder) {
      const exitPx = markPrice(state.fastTrade.dir, state.ticker) || simLastPrice();
      const tr = state.fastTrade;
      if (tr && tr.status === 'open') {
        const done = {
          dir: tr.dir,
          entry: tr.entry,
          tp: tr.tp,
          sl: tr.sl,
          t: tr.t,
          entryAt: tr.entryAt,
          reason: tr.reason,
          setup: tr.setup,
          status: 'manual',
          exit: exitPx,
          exitAt: Date.now(),
          spread: tr.spread,
          pnl: simPnl(tr.entry, exitPx, tr.dir, tr.spread),
        };
        state.fastLast = done;
        state.fastHist = state.fastHist.concat([done]).slice(-6);
        state.fastMarks = state.fastMarks.concat([{ t: tr.t, dir: tr.dir }]).slice(-12);
        state.fastTrade = null;
        state.fastWatch = null;
        state.fastCoolUntil = Date.now() + fastCoolMs();
        
        const order = state.simOrders.find(o => o.id === fastOrder.id && o.status === 'open');
        if (order) {
          order.exit = done.exit;
          order.pnl = done.pnl;
          order.status = 'closed';
          order.closeAt = done.exitAt;
          order.kind = 'manual';
        }
      }
    }
    
    const remaining = simOpenOrders();
    const toCloseManual = remaining.filter(o => openIds.includes(o.id) && o.id !== (fastOrder ? fastOrder.id : null));
    
    toCloseManual.forEach((o) => {
      const exitPx = simMarkExit(o);
      const cost = o.source === 'fast' ? simOrderSpread(o) : null;
      o.exit = exitPx;
      o.pnl = simPnl(o.entry, exitPx, o.dir, cost);
      o.status = 'closed';
      o.closeAt = Date.now();
      if (o.source === 'fast' && !o.kind) o.kind = 'manual';
    });
    
    saveSim();
    
    const allClosed = (state.simOrders || []).filter(o => 
      openIds.includes(o.id) && o.status === 'closed'
    );
    const sum = allClosed.reduce((a, o) => a + (o.pnl || 0), 0);
    
    renderSimDialog();
    state.chartScale = null;
    scheduleChart();
    renderFastPanel();
    
    // 只显示简洁消息，不显示具体盈亏数字
    setSimMsg('已平 ' + allClosed.length + ' 笔', 'ok');
    
  } catch (e) {
    setSimMsg('平仓异常，请重试', 'err');
    console.error('closeAllSimTrades error:', e);
  } finally {
    state._closingAll = false;
    if (closeAllBtn) closeAllBtn.disabled = !simOpenOrders().length;
  }
}

export function tickSimTrade(price) {
  if (price == null) {
    renderSimLiveBtn();
    return;
  }
  patchSimFloat(price);
}

export function bindSimUi() {
  const dlg = $('simDlg');
  const btn = $('btnSim');
  if (btn) btn.addEventListener('click', () => openSimDialog());
  const closeBtn = $('btnSimClose');
  if (closeBtn) closeBtn.addEventListener('click', () => closeSimDialog());
  if (dlg) {
    dlg.addEventListener('close', () => {
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) closeSimDialog();
    });
  }
  document.querySelectorAll('[data-sim-dir]').forEach((b) => {
    b.addEventListener('click', () => {
      state.simDir = Number(b.dataset.simDir) === -1 ? -1 : 1;
      state.simJudge = null;
      saveSim();
      syncSimDirButtons();
      renderSimJudge();
    });
  });
  const autoSwitch = $('simAutoSwitch');
  if (autoSwitch) {
    autoSwitch.addEventListener('click', () => {
      state.simAuto = !state.simAuto;
      if (state.simAuto && !state.ind.fast) {
        state.ind.fast = true;
        saveInd();
        syncIndButtons();
        renderFastPanel();
      }
      saveSim();
      syncSimAutoUi();
      renderSimLiveBtn();
      setSimMsg(state.simAuto ? '自动开单已开启，等待收盘信号' : '自动开单已关闭，已有持仓继续按原计划管理', state.simAuto ? 'ok' : '');
    });
  }
  document.querySelectorAll('[data-sim-param]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.simParam;
      const value = clampSimParam(key, input.value);
      if (value == null) return;
      state.simAutoParams[key] = value;
      input.value = String(value);
      saveSim();
      renderFastPanel();
      setSimMsg('自动开单参数已保存，下一笔新单生效', 'ok');
    });
  });
  const judgeBtn = $('btnSimJudge');
  if (judgeBtn) {
    judgeBtn.addEventListener('click', () => {
      judgeBtn.disabled = true;
      judgeBtn.dataset.state = 'loading';
      judgeBtn.textContent = '判断中';
      window.setTimeout(() => {
        try { judgeSimDirection(); }
        finally {
          judgeBtn.disabled = false;
          delete judgeBtn.dataset.state;
          judgeBtn.textContent = '判断多空';
        }
      }, 0);
    });
  }
  const openBtn = $('btnSimOpen');
  if (openBtn) openBtn.addEventListener('click', () => openSimTrade());
  const closeAllBtn = $('btnSimCloseAll');
  if (closeAllBtn) closeAllBtn.addEventListener('click', () => closeAllSimTrades());
  const histBox = $('simHistBox');
  if (histBox) {
    histBox.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('[data-sim-close]') : null;
      if (!t) return;
      closeSimTrade(t.getAttribute('data-sim-close'));
    });
  }
  const clearBtn = $('btnSimClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!simClosedOrders().length) {
        setSimMsg('没有可清空的已平仓订单');
        return;
      }
      if (!window.confirm('清空本机全部已平仓订单？持仓不会动。')) return;
      state.simOrders = simOpenOrders();
      saveSim();
      renderSimDialog();
      setSimMsg('已清空已平仓订单', 'ok');
    });
  }
  renderSimLiveBtn();
  syncSimDirButtons();
}
