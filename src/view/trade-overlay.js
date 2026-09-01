import { closedFastBars } from '../core/bars.js';
import { px } from '../core/format.js';
import { $, H, PAD, W, isMarketOpen, state } from '../state.js';
import { closeFastTrade, fastContext, fastKindLabel, fastWaitWhy, markPrice, remainFast, setupKindLabel } from '../trade/fast.js';
import { simOpenOrders } from '../trade/sim.js';
import { applyFastPos } from '../ui/fast-float.js';
import { wrap } from './chart.js';
import { svgEl } from './svg.js';

export function openSignalView() {
  const tr = (state.fastTrade && state.fastTrade.status === 'open') ? state.fastTrade : null;
  const watch = state.fastWatch;
  const last = state.fastLast;
  const now = Date.now();
  if (tr) {
    return {
      mode: 'open', dir: tr.dir, title: tr.dir > 0 ? '开多' : '开空',
      why: tr.reason, cls: tr.dir > 0 ? 'bull' : 'bear', show: tr,
    };
  }
  if (watch) {
    return {
      mode: 'armed', dir: watch.dir, title: watch.dir > 0 ? '预备开多' : '预备开空',
      why: watch.reason, cls: 'armed', show: watch,
    };
  }
  if (last && now - last.exitAt < 12000) {
    return {
      mode: 'done', dir: last.dir, title: '刚平 · ' + fastKindLabel(last.status),
      why: last.reason, cls: last.pnl >= 0 ? 'bull' : 'bear', show: last,
    };
  }
  return { mode: 'wait', dir: 0, title: '等待开单', why: '', cls: 'chop', show: null };
}

export function placeOpenBadge(sig) {
  const el = $('openBadge');
  if (!el) return;
  if (!state.ind.fast || !sig || sig.mode === 'wait') {
    el.hidden = true;
    el.className = 'open-badge';
    return;
  }
  el.hidden = false;
  el.textContent = sig.title;
  el.className = 'open-badge show' + (sig.cls ? ' ' + sig.cls : '');
}

export function basisHtml(ctx) {
  if (!ctx) return '';
  const chips = [];
  const chip = (txt, cls) => chips.push('<span class="' + (cls || '') + '">' + txt + '</span>');
  if (ctx.m1b) chip('1分' + ctx.m1b.label, ctx.m1b.vote > 0 ? 'bull' : (ctx.m1b.vote < 0 ? 'bear' : ''));
  if (ctx.m5b) chip('5分' + ctx.m5b.label, ctx.m5b.vote > 0 ? 'bull' : (ctx.m5b.vote < 0 ? 'bear' : ''));
  if (ctx.r != null) chip('RSI ' + Math.round(ctx.r), '');
  if (ctx.a != null && ctx.last && ctx.last.c != null) {
    chip(ctx.last.c >= ctx.a ? '收于EMA9上' : '收于EMA9下', '');
  }
  if (ctx.spread != null && ctx.spread > 0) chip('点差 ' + px(ctx.spread, 2), '');
  return chips.join('');
}

export function renderFastPanel() {
  const box = $('fastBox');
  const mobileState = $('mobileFastState');
  const mobileEntry = $('mobileFastEntry');
  const mobileTp = $('mobileFastTp');
  const mobileSl = $('mobileFastSl');
  if (box) {
    box.hidden = !state.ind.fast;
    if (!state.ind.fast) box.classList.remove('is-placed');
    else if (!state.fastDrag) applyFastPos(false);
  }
  if (!state.ind.fast) {
    if (mobileState) {
      mobileState.textContent = '未启用';
      mobileState.className = '';
    }
    if (mobileEntry) mobileEntry.textContent = '--';
    if (mobileTp) mobileTp.textContent = '--';
    if (mobileSl) mobileSl.textContent = '--';
    if (state.fastTrade && state.fastTrade.status === 'open') {
      const pxNow = markPrice(state.fastTrade.dir, state.ticker) || state.fastTrade.entry;
      closeFastTrade('off', pxNow, Date.now());
      return;
    }
    state.fastWatch = null;
    placeFastTags();
    placeOpenBadge(null);
    return;
  }
  const dirEl = $('fastDir');
  const remainEl = $('fastRemain');
  const basisEl = $('fastBasis');
  const lvEl = $('fastLv');
  const whyEl = $('fastWhy');
  const histEl = $('fastHist');
  if (!dirEl || !lvEl) return;
  const now = Date.now();
  const closed = closedFastBars(now);
  const ctx = fastContext(closed.length ? closed : (state.fast || []), state.ticker);
  const sig = openSignalView();
  let title = sig.title;
  let remain = '';
  let why = sig.why || fastWaitWhy(ctx, state.ticker);
  let showLv = sig.show;
  if (sig.mode === 'wait') {
    if (!isMarketOpen(state.ticker)) {
      title = '休市';
      why = '当前时段不可交易，开盘后再给开单信号。';
    } else if (closed.length < 30) {
      title = '样本不足';
      why = '还在补 10 秒 K 线，至少需要约 30 根收盘棒。';
    } else if (now < state.fastCoolUntil) {
      title = '冷却';
      remain = '下一单 ' + Math.max(0, Math.ceil((state.fastCoolUntil - now) / 1000)) + ' 秒后';
      why = '刚平过一单，短暂停一下避免连打。';
    } else {
      title = '等待开单';
      if (ctx && ctx.m1b && ctx.m5b) {
        remain = '1分 ' + ctx.m1b.label + '  ·  5分 ' + ctx.m5b.label;
      }
    }
  } else if (sig.mode === 'open') {
    const tr = sig.show;
    remain = '盈 ' + px(Math.abs(tr.tp - tr.entry), 2) + '  损 ' + px(Math.abs(tr.sl - tr.entry), 2) +
      '  ·  剩余 ' + remainFast(tr, now) +
      (setupKindLabel(tr.setup) ? ' · ' + setupKindLabel(tr.setup) : '');
  } else if (sig.mode === 'armed') {
    remain = '等这根10秒收盘确认';
  } else if (sig.mode === 'done') {
    const last = sig.show;
    remain = (last.dir > 0 ? '多' : '空') + '  ' + (last.pnl >= 0 ? '+' : '') + px(last.pnl, 2);
  }
  dirEl.textContent = title;
  dirEl.classList.toggle('is-armed', sig.mode === 'armed');
  dirEl.classList.toggle('pulse-alert', sig.mode === 'armed');  // 新增视觉闪烁
  if (box) {
    box.classList.remove('bull', 'bear', 'chop', 'armed');
    box.classList.add(sig.cls || 'chop');
    box.classList.toggle('pulse-alert', sig.mode === 'armed');  // 新增视觉闪烁
  }
  if (mobileState) {
    mobileState.textContent = title;
    mobileState.className = sig.mode === 'armed' ? 'armed' : (sig.dir > 0 ? 'bull' : (sig.dir < 0 ? 'bear' : ''));
  }
  if (remainEl) remainEl.textContent = remain;
  if (showLv && showLv.entry != null) {
    if (mobileEntry) mobileEntry.textContent = px(showLv.entry);
    if (mobileTp) mobileTp.textContent = px(showLv.tp);
    if (mobileSl) mobileSl.textContent = px(showLv.sl);
    const tpD = (showLv.dir > 0 ? '+' : '-') + px(Math.abs(showLv.tp - showLv.entry), 2);
    const slD = (showLv.dir > 0 ? '-' : '+') + px(Math.abs(showLv.sl - showLv.entry), 2);
    lvEl.innerHTML =
      '<div class="cell"><span class="k">入场</span><b>' + px(showLv.entry) + '</b></div>' +
      '<div class="cell"><span class="k">止盈</span><b>' + px(showLv.tp) + '</b><span class="d">' + tpD + '</span></div>' +
      '<div class="cell"><span class="k">止损</span><b>' + px(showLv.sl) + '</b><span class="d">' + slD + '</span></div>';
  } else {
    if (mobileEntry) mobileEntry.textContent = '--';
    if (mobileTp) mobileTp.textContent = '--';
    if (mobileSl) mobileSl.textContent = '--';
    lvEl.innerHTML =
      '<div class="cell"><span class="k">入场</span><b>--</b></div>' +
      '<div class="cell"><span class="k">止盈</span><b>--</b></div>' +
      '<div class="cell"><span class="k">止损</span><b>--</b></div>';
  }
  if (whyEl) whyEl.textContent = why;
  if (basisEl) basisEl.innerHTML = basisHtml(ctx);
  if (histEl) {
    histEl.setAttribute('title', '最近25分钟纸面信号复盘（最多6笔），不是回测胜率；点差取刷新时刻盘口');
    histEl.setAttribute('aria-label', '最近25分钟纸面信号复盘，最多6笔，不是回测胜率');
    if (!state.fastHist.length) {
      histEl.innerHTML = '<span>暂无近25分钟复盘</span>';
    } else {
      histEl.innerHTML = state.fastHist.map((h) => {
        const cls = h.status === 'tp' ? 'tp' : h.status === 'sl' ? 'sl' : h.status === 'time' ? 'time' : 'invalid';
        return '<span class="' + cls + '">' + (h.dir > 0 ? '多' : '空') + fastKindLabel(h.status) + '</span>';
      }).join('') + (state.fastReplayOpenLeft ? '<span class="time">未了结已忽略</span>' : '');
    }
  }
  placeFastTags();
  placeOpenBadge(sig);
}

export function openFastTrade() {
  return (state.fastTrade && state.fastTrade.status === 'open') ? state.fastTrade : null;
}

export function placeLevelTag(id, price, show, lab) {
  const tag = $(id);
  const wrap = $('chartWrap');
  const s = state.chartScale;
  if (!tag || !wrap) return;
  if (!show || price == null || !s || !s.y) {
    tag.classList.remove('show');
    return;
  }
  const yy = s.y(price);
  const yPx = yy / H * wrap.clientHeight;
  tag.style.top = Math.min(wrap.clientHeight - 12, Math.max(12, yPx)) + 'px';
  tag.textContent = (lab || '') + px(price);
  tag.classList.add('show');
}

export function placeFastTags() {
  const tr = openFastTrade() || (state.ind.fast ? state.fastWatch : null);
  const show = !!(state.ind.fast && tr && tr.entry != null);
  placeLevelTag('fastEntryTag', tr && tr.entry, show, '入 ');
  placeLevelTag('fastTpTag', tr && tr.tp, show, '盈 ');
  placeLevelTag('fastSlTag', tr && tr.sl, show, '损 ');
  placeSimTags();
}

export function placeSimTags() {
  const box = $('simTags');
  const wrap = $('chartWrap');
  const s = state.chartScale;
  if (!box) return;
  box.replaceChildren();
  const opens = simOpenOrders();
  if (!wrap || !s || !s.y || !opens.length) return;
  opens.filter((o) => o.source !== 'fast').slice(-8).forEach((o) => {
    const tag = document.createElement('div');
    tag.className = 'lvl-tag sim entry num show';
    if (o.dir > 0) tag.classList.add('tp');
    else tag.classList.add('sl');
    const yy = s.y(o.entry);
    const yPx = yy / H * wrap.clientHeight;
    tag.style.top = Math.min(wrap.clientHeight - 12, Math.max(12, yPx)) + 'px';
    tag.textContent = (o.dir > 0 ? '多 ' : '空 ') + px(o.entry);
    box.appendChild(tag);
  });
}

export function drawFastOverlay(svg, vis, view, x, y) {
  const tr = openFastTrade();
  if (state.ind.fast && tr) {
    const rows = [
      { v: tr.entry, color: 'var(--ink-1)', dash: '', w: '1.2' },
      { v: tr.tp, color: 'var(--up)', dash: '4 3', w: '1.1' },
      { v: tr.sl, color: 'var(--down)', dash: '4 3', w: '1.1' },
    ];
    rows.forEach((row) => {
      svg.appendChild(svgEl('line', {
        x1: PAD.l, x2: W - PAD.r, y1: y(row.v), y2: y(row.v),
        stroke: row.color, 'stroke-width': row.w, 'stroke-dasharray': row.dash, opacity: '.72',
      }));
    });
  }
  if (!state.ind.fast || state.tf !== '10s') return;
  const marks = state.fastMarks || [];
  const openT = tr ? tr.t : null;
  marks.forEach((mk) => {
    const vi = vis.findIndex((b) => b.t === mk.t);
    if (vi < 0) return;
    const bar = vis[vi];
    const xc = x(vi);
    const upMk = mk.dir > 0;
    const yy = upMk ? y(bar.l) + 10 : y(bar.h) - 10;
    svg.appendChild(svgEl('polygon', {
      points: upMk
        ? xc.toFixed(1) + ',' + (yy - 6).toFixed(1) + ' ' + (xc - 5).toFixed(1) + ',' + (yy + 4).toFixed(1) + ' ' + (xc + 5).toFixed(1) + ',' + (yy + 4).toFixed(1)
        : xc.toFixed(1) + ',' + (yy + 6).toFixed(1) + ' ' + (xc - 5).toFixed(1) + ',' + (yy - 4).toFixed(1) + ' ' + (xc + 5).toFixed(1) + ',' + (yy - 4).toFixed(1),
      fill: upMk ? 'var(--up)' : 'var(--down)',
      opacity: '.85',
    }));
  });
  if (openT != null) {
    const vi = vis.findIndex((b) => b.t === openT);
    if (vi >= 0) {
      const bar = vis[vi];
      const xc = x(vi);
      const upMk = tr.dir > 0;
      const yy = upMk ? y(bar.l) + 10 : y(bar.h) - 10;
      svg.appendChild(svgEl('polygon', {
        points: upMk
          ? xc.toFixed(1) + ',' + (yy - 6).toFixed(1) + ' ' + (xc - 5).toFixed(1) + ',' + (yy + 4).toFixed(1) + ' ' + (xc + 5).toFixed(1) + ',' + (yy + 4).toFixed(1)
          : xc.toFixed(1) + ',' + (yy + 6).toFixed(1) + ' ' + (xc - 5).toFixed(1) + ',' + (yy - 4).toFixed(1) + ' ' + (xc + 5).toFixed(1) + ',' + (yy - 4).toFixed(1),
        fill: upMk ? 'var(--up)' : 'var(--down)',
        opacity: '1',
      }));
    }
  }
}

export function drawSimOverlay(svg, y) {
  const opens = simOpenOrders();
  if (!opens.length) return;
  opens.forEach((o) => {
    if (o.entry == null || o.source === 'fast') return;
    svg.appendChild(svgEl('line', {
      x1: PAD.l, x2: W - PAD.r, y1: y(o.entry), y2: y(o.entry),
      stroke: o.dir > 0 ? 'var(--up)' : 'var(--down)',
      'stroke-width': '1.15', 'stroke-dasharray': '3 3', opacity: '.78',
    }));
  });
}
