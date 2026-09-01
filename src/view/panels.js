import { fmtBarTime, fmtClock, fmtFunding, fmtHm, px } from '../core/format.js';
import { bwRankWindow } from '../core/math.js';
import { analyzeBoll, bollMacdSignal } from '../indicators/boll.js';
import { getBox } from '../indicators/box.js';
import { STACK_GLOSS, STACK_TFS, getStack, stackKindText, stackSame, stackTrend } from '../indicators/stack.js';
import { getSuperTrend } from '../indicators/supertrend.js';
import { judge } from '../judge/judge.js';
import { sortFactorsByOrder } from '../judge/factors.js';
import { mtfBias } from '../judge/votes.js';
import { barsForChart } from '../net/rest.js';
import { $, isMarketOpen, mkt, state } from '../state.js';
import { tickSimTrade } from '../trade/sim.js';
import { bollSt } from '../ui/indicator-menu.js';
import { paintChart } from './chart.js';
import { openSignalView, renderFastPanel } from './trade-overlay.js';

export function liveLabel() {
  if (state.paused) return '已暂停';
  if (state.wsOk) return '实时推送';
  return '轮询备份';
}

export function setDelta(el, v) {
  el.className = 'delta ' + (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
}

export function remainText(closeTime) {
  if (!closeTime) return '--';
  const s = closeTime - Math.floor(Date.now() / 1000);
  if (s <= 0) return mkt().hasSession ? '已结束' : '结算中';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h + '小时' + m + '分';
}

export function spark(closes, vote) {
  if (closes.length < 2) return '';
  const w = 120, h = 28;
  let lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
  if (hi === lo) { hi += 1; lo -= 1; }
  const d = closes.map((v, i) => {
    const x = i / (closes.length - 1) * w;
    const y = h - 2 - (v - lo) / (hi - lo) * (h - 4);
    return (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const color = vote > 0 ? 'var(--up)' : vote < 0 ? 'var(--down)' : 'var(--ink-3)';
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.6"/></svg>';
}

export function bwSpark(values) {
  const xs = (values || []).filter((v) => v != null);
  if (xs.length < 2) return '';
  const w = 96, h = 18;
  let lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
  if (hi === lo) { hi += 0.0001; lo -= 0.0001; }
  const d = xs.map((v, i) => {
    const x = i / (xs.length - 1) * w;
    const y = h - 2 - (v - lo) / (hi - lo) * (h - 4);
    return (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return '<svg class="bw-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + bollSt(2).line + '" stroke-width="1.4"/></svg>';
}

export function renderBollStatus(klines) {
  const el = $('bollStatus');
  if (!el) return;
  if (!state.ind.boll) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  const b = analyzeBoll(klines);
  if (!b.ok) {
    el.innerHTML = '<span>布林样本不足，至少需要 ' + ((state.bollN || 20) + 2) + ' 根</span>';
    return;
  }
  const pb = b.lastPb == null ? '--' : b.lastPb.toFixed(2);
  const bw = b.lastBw == null ? '--' : ((b.lastBw * 100).toFixed(2) + '%');
  const bwWin = bwRankWindow(state.tf);
  const rank = b.bwRank == null ? '' : '（近' + bwWin + '根 ' + Math.round(b.bwRank * 100) + '% 分位）';
  let macdHtml = '';
  if (state.ind.macd) {
    const s = bollMacdSignal(klines);
    const col = s.vote > 0 ? 'var(--up)' : s.vote < 0 ? 'var(--down)' : 'var(--ink-2)';
    macdHtml = '<span>复合 <b style="color:' + col + '">' + s.label + '</b></span>';
  }
  el.innerHTML =
    '<span>%B <b>' + pb + '</b></span>' +
    '<span>带宽 <b>' + bw + '</b>' + rank + '</span>' +
    bwSpark(b.bw.slice(-bwRankWindow(state.tf))) +
    '<span>' + b.shape + '</span>' +
    '<span>' + b.touchKind + '</span>' +
    macdHtml;
}

export function renderStState(klines) {
  const el = $('stState');
  if (!el) return;
  if (!state.ind.st) {
    el.innerHTML = '';
    return;
  }
  const pack = getSuperTrend(klines);
  if (!pack.ok) {
    el.innerHTML = '<span>' + pack.why + '</span>';
    return;
  }
  const cls = pack.lastDir > 0 ? 'up' : 'dn';
  const lab = pack.lastDir > 0 ? '多' : '空';
  const last = klines[klines.length - 1];
  const dist = (last && pack.last != null) ? Math.abs(last.c - pack.last) : null;
  const bars = pack.barsSinceFlip;
  el.innerHTML =
    '<i class="st-flag ' + cls + '">' + lab + '</i>' +
    '<span>翻转位 <b>' + px(pack.last) + '</b></span>' +
    '<span>距现价 <b>' + (dist == null ? '--' : px(dist)) + '</b></span>' +
    '<span>' + (bars == null ? '本段自起点延续' : ('本段已走 <b>' + bars + '</b> 根')) + '</span>';
}

export function renderBoxStatus(klines) {
  const el = $('boxStatus');
  if (!el) return;
  if (!state.ind.box) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  const b = getBox(klines);
  if (!b.ok) {
    el.innerHTML = '<span>' + b.why + '</span>';
    return;
  }
  const cls = b.status === 'breakUp' ? 'up' : (b.status === 'breakDn' ? 'dn' : 'mid');
  const atrTxt = b.atrv ? (b.height / b.atrv).toFixed(1) : '--';
  const posPct = b.pos == null ? null : Math.max(0, Math.min(1, b.pos)) * 100;
  const track = posPct == null
    ? ''
    : '<span class="box-track" aria-hidden="true"><i class="box-dot" style="left:' + posPct.toFixed(1) + '%"></i></span>';
  const extHtml = b.extension
    ? '<span>' + b.extensionLab + ' · ' + b.extension.anchorCount + '组锚点</span>'
    : '<span>扩展：无足够方向证据</span>';
  const targetHtml = b.target == null ? '' : '<span>量度目标 <b>' + px(b.target) + '</b> · 结构参考</span>';
  el.innerHTML =
    '<i class="box-flag ' + cls + '">' + b.statusLab + '</i>' +
    '<span>箱体 <b>' + px(b.bottom) + '</b>–<b>' + px(b.top) + '</b></span>' +
    '<span>高度 <b>' + px(b.height) + '</b> · <b>' + atrTxt + '</b> ATR</span>' +
    '<span>上沿 <b>' + b.topTouches + '</b> 次 · 下沿 <b>' + b.botTouches + '</b> 次</span>' +
    extHtml + targetHtml + track +
    '<span>' + (b.pos == null ? b.posLab : (b.posLab + ' ' + Math.round(b.pos * 100) + '%')) + '</span>';
}

export function renderStackBar() {
  const el = $('stackBar');
  if (!el) return;
  if (!state.ind.stack) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  const st = getStack();
  const layers = (st && st.layers) || {};
  const kindCls = st && st.dir > 0 ? 'up' : (st && st.dir < 0 ? 'dn' : 'mid');
  const kindLab = stackKindText(st);
  const trend = (st && st.trend) || stackTrend(layers);
  const trendCls = (trend && trend.cls) || 'mid';
  const trendLab = (trend && trend.lab) ? trend.lab : '走平';
  const trendWhy = (trend && trend.why) ? trend.why : '';
  const collapsed = !!state.stackCollapsed;
  const foldTitle = collapsed ? '展开套轨卡片' : '收起套轨卡片';
  const foldButton = '<button type="button" class="stack-fold" data-stack-fold aria-expanded="' + String(!collapsed) + '" title="' + foldTitle + '" aria-label="' + foldTitle + '">' +
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 6l4.5 4 4.5-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '</button>';
  el.classList.toggle('is-collapsed', collapsed);
  if (collapsed) {
    el.innerHTML = '<div class="stack-compact">' +
      '<span class="stack-name">套轨</span>' +
      '<b class="stack-kind ' + kindCls + '">' + kindLab + '</b>' +
      '<span class="stack-compact-trend ' + trendCls + '" title="' + String(trendWhy).replace(/"/g, '&quot;') + '">' + trendLab + '</span>' +
      foldButton +
    '</div>';
    return;
  }
  const rows = STACK_TFS.map((x) => {
    const L = layers[x.id] || {
      lab: '样本不足', lastPb: null, lastUp: null, lastMid: null, lastDn: null,
      bwRank: null, dir: 0,
    };
    const pb = L.lastPb;
    const left = pb == null ? 50 : Math.max(2, Math.min(98, pb * 100));
    const thick = L.bwRank == null ? 8 : Math.max(5, Math.min(12, 5 + L.bwRank * 7));
    const rowCls = L.dir > 0 ? 'up' : (L.dir < 0 ? 'dn' : 'mid');
    const bands = '<span class="stack-bands num" title="最近一根已收盘 K 线的布林价格">' +
      '<span><i>上</i>' + px(L.lastUp) + '</span>' +
      '<span><i>中</i>' + px(L.lastMid) + '</span>' +
      '<span><i>下</i>' + px(L.lastDn) + '</span>' +
      '</span>';
    return '<div class="stack-row ' + rowCls + '">' +
      '<span class="tf">' + x.name + '</span>' +
      '<span class="stack-track" style="height:' + thick.toFixed(0) + 'px">' +
        '<i class="mid"></i>' +
        '<i class="stack-dot" style="left:' + left.toFixed(1) + '%"></i>' +
      '</span>' +
      '<span class="ph">' + L.lab + '</span>' + bands +
    '</div>';
  }).join('');
  const aligned = st && st.layers && stackSame(st.layers['1h'], st.layers['1h'] && st.layers['1h'].dir)
    && stackSame(st.layers['15m'], st.layers['1h'] && st.layers['1h'].dir)
    && stackSame(st.layers['5m'], st.layers['1h'] && st.layers['1h'].dir);
  const spine = aligned && st.layers['1h'] && st.layers['1h'].dir ? '<div class="stack-spine" aria-hidden="true"></div>' : '';
  const mean = (STACK_GLOSS.filter(function (g) { return g.lab === trendLab; })[0] || {}).mean
    || '1 小时布林样本还不够，不能定性。';
  const whyNorm = String(trendWhy || '').replace(/\s+/g, '').replace(/[。，]/g, '');
  const meanNorm = String(mean || '').replace(/\s+/g, '').replace(/[。，]/g, '');
  const extraWhy = whyNorm && meanNorm.indexOf(whyNorm) < 0 && whyNorm.indexOf(meanNorm) < 0;
  const keys = STACK_GLOSS.map(function (g) {
    const on = g.lab === trendLab;
    return '<li class="' + (on ? ('is-on ' + g.cls) : '') + '"><b>' + g.lab + '</b> ' + g.mean + '</li>';
  }).join('');
  el.innerHTML =
    '<div class="stackbar">' +
      '<div class="stack-main">' +
        '<div class="stack-head">' +
          '<span class="stack-name">套轨</span>' +
          '<b class="stack-kind ' + kindCls + '">' + kindLab + '</b>' +
          foldButton +
        '</div>' + spine + rows +
      '</div>' +
      '<div class="stack-bias ' + trendCls + (trend && trend.weak ? ' weak' : '') + '" title="' + String(trendWhy).replace(/"/g, '&quot;') + '">' + trendLab + '</div>' +
    '</div>' +
    '<aside class="stack-gloss">' +
      '<p class="now ' + trendCls + '">' + trendLab + '：' + mean + (extraWhy ? ('当前分层：' + trendWhy + '。') : '') + '</p>' +
      '<ul class="keys">' + keys + '</ul>' +
    '</aside>';
}

export function renderQuote() {
  const t = state.ticker;
  $('clock').textContent = fmtClock();
  if (!t) return;
  $('lastPx').textContent = px(t.last);
  $('chgChip').textContent = (t.chg >= 0 ? '+' : '') + px(t.chg, 2) + '%';
  setDelta($('chgChip'), t.chg);
  $('chgAmt').textContent = (t.chgAmt >= 0 ? '+' : '') + px(t.chgAmt);
  setDelta($('amtChip'), t.chgAmt);
  $('amtChip').textContent = t.chgAmt >= 0 ? '上涨' : '下跌';
  $('dayRange').textContent = '高 ' + px(t.high) + '  /  低 ' + px(t.low);
  $('remain').textContent = remainText(t.closeTime);
  if (mkt().hasSession) {
    $('sessHours').textContent = (t.openTime ? fmtHm(t.openTime) : '--') + ' 开  /  ' + (t.closeTime ? fmtHm(t.closeTime) : '--') + ' 收';
  } else {
    $('sessHours').textContent = '费率 ' + fmtFunding(t.funding);
  }
  $('settle').textContent = t.settle || '--';
  $('openPx').textContent = px(t.open);
  $('prevPx').textContent = px(t.prev);
  const open = isMarketOpen(t);
  $('sessText').textContent = (mkt().hasSession
    ? (open ? '交易中' : (t.status === 'closed' ? '已收盘' : (t.status || '未知')))
    : '永续 24h') + (state.wsOk && !state.paused ? ' · 实时' : '');
  $('sessChip').className = 'chip ' + (open ? 'open' : 'closed');
  $('liveDot').className = 'live' + ((open || state.wsOk) && !state.paused ? ' on' : '');
  $('lastSub').textContent = mkt().symbol + ' · ' + liveLabel();
  if (t.last != null) tickSimTrade(t.last);
}

export function renderHeavy(klines) {
  renderFastPanel();
  renderBollStatus(klines);
  renderStackBar();
  renderStState(klines);
  renderBoxStatus(klines);
  const t = state.ticker;
  const j = judge(klines, t, state.mtf);

  const card = $('biasCard');
  card.classList.remove('bull', 'bear', 'chop');
  if (j.cls) card.classList.add(j.cls);
  $('biasDir').textContent = j.dir;
  $('biasAgree').textContent = j.agree;
  $('biasHint').textContent = j.hint;
  const sig = openSignalView();
  if (sig && (sig.mode === 'open' || sig.mode === 'armed')) {
    card.classList.remove('bull', 'bear', 'chop');
    card.classList.add(sig.dir > 0 ? 'bull' : 'bear');
    $('biasDir').textContent = sig.title;
    if (sig.why) $('biasHint').textContent = sig.why;
  }
  const auditEl = $('biasAudit');
  if (auditEl) {
    auditEl.textContent = j.audit || '';
    auditEl.hidden = !j.audit;
    auditEl.className = 'audit' + (j.auditWarn ? ' warn' : '');
  }
  const facList = sortFactorsByOrder(j.factors, state.facOrder);
  // 拖拽重排期间跳过重建，避免报价推送打断用户正在拖的行
  if (!state._facDrag) {
    $('factors').innerHTML = facList.map((f) => {
      const cls = f.vote > 0 ? 'bull' : f.vote < 0 ? 'bear' : 'mid';
      const lab = f.vote > 0 ? '多' : f.vote < 0 ? '空' : '中';
      const core = f.core ? '<span class="core">核心</span>' : '';
      return '<div class="factor" draggable="true" data-fac-id="' + f.id + '" title="按住拖动可调整因子顺序">' +
        '<div class="name">' + f.name + core + '</div>' +
        '<div class="vote ' + cls + '">' + lab + '</div>' +
        '<div class="why">' + f.why + '</div></div>';
    }).join('');
  }

  const tfs = [
    { id: '1m', name: '1分' },
    { id: '5m', name: '5分' },
    { id: '15m', name: '15分' },
    { id: '1h', name: '1小时' },
  ];
  $('mtf').innerHTML = tfs.map((x) => {
    const src = x.id === state.tf ? klines : state.mtf[x.id];
    const b = mtfBias(src);
    const color = b.vote > 0 ? 'var(--up)' : b.vote < 0 ? 'var(--down)' : 'var(--ink-2)';
    return '<div class="mtf-item"><div class="tf">' + x.name + '</div><div class="d" style="color:' + color + '">' + b.label + '</div>' + spark(b.closes.slice(-40), b.vote) + '</div>';
  }).join('');

  const rows = klines.slice(-24).reverse();
  $('ohlcBody').innerHTML = rows.map((k) => {
    const d = k.c - k.o;
    const cls = d >= 0 ? 'up' : 'dn';
    return '<tr><td>' + fmtBarTime(k.t) + '</td><td>' + px(k.o) + '</td><td>' + px(k.h) + '</td><td>' + px(k.l) + '</td><td>' + px(k.c) + '</td><td class="' + cls + '">' + (d >= 0 ? '+' : '') + px(d) + '</td></tr>';
  }).join('');
}

export function render() {
  const klines = barsForChart();
  renderQuote();
  paintChart(klines);
  renderHeavy(klines);
}

export function scheduleQuote() {
  if (state.quoteRaf) return;
  state.quoteRaf = requestAnimationFrame(() => {
    state.quoteRaf = 0;
    renderQuote();
    scheduleChart();
  });
}

export function scheduleChart() {
  if (state.chartRaf) return;
  state.chartRaf = requestAnimationFrame(() => {
    state.chartRaf = 0;
    const klines = barsForChart();
    const closed = state.barClosed;
    paintChart(klines);
    const now = Date.now();
    if (closed || now - state.heavyAt > 800) {
      state.barClosed = false;
      state.heavyAt = now;
      renderHeavy(klines);
    }
  });
}

export function banner(msg, show) {
  const el = $('banner');
  el.textContent = msg || '';
  el.classList.toggle('show', !!show);
}
