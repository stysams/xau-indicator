import { fmtBarTime, fmtHm, px } from '../core/format.js';
import { getBox } from '../indicators/box.js';
import { getFib } from '../indicators/fib.js';
import { getHkld } from '../indicators/hkld.js';
import { getHold } from '../indicators/hold.js';
import { getPb } from '../indicators/pb.js';
import { getSmc } from '../indicators/smc.js';
import { getSr } from '../indicators/sr.js';
import { getStack, stackMarkIndex } from '../indicators/stack.js';
import { getSuperTrend } from '../indicators/supertrend.js';
import { getTrap } from '../indicators/trap.js';
import { factorOn } from '../judge/factors.js';
import { xauUsidxVote } from '../judge/votes.js';
import { $, H, PAD, W, state } from '../state.js';
import { svgEl } from './svg.js';

const SIG_MAX = 48;

function pushSig(out, item) {
  if (!item || item.i == null || item.i < 0) return;
  out.push(item);
}

function dedupeSigs(list) {
  const seen = Object.create(null);
  const out = [];
  list.forEach((s) => {
    const key = [s.kind, s.i, s.dir || 0, s.lab || ''].join('|');
    if (seen[key]) return;
    seen[key] = true;
    out.push(s);
  });
  out.sort((a, b) => a.i - b.i || String(a.kind).localeCompare(String(b.kind)));
  return out.slice(-SIG_MAX);
}

const SIGNAL_FACTOR = {
  hold: 'hold', trap: 'trap', bounce: 'bounce', pull: 'pull', smc: 'smc', bos: 'smc',
  stack: 'stack', hkld: 'hkld', fib: 'fib', sr: 'sr',
};

// 技术事件只在其对应判断因子启用时进入时间线。关系因子可用时，以事件
// 当时可见的数据复核 XAU-USIDX；关系已确认但方向相反的事件不展示。
export function matchSignalsToFactors(events, klines, usidx, useXauUsidx) {
  const macroOn = useXauUsidx == null ? factorOn('xauUsidx') : useXauUsidx;
  return (events || []).filter((event) => {
    const factor = SIGNAL_FACTOR[event.kind];
    if (factor && !factorOn(factor)) return false;
    if (!macroOn || !event.dir || event.i == null || !klines || !usidx || !usidx.length) return true;
    const at = klines[event.i];
    if (!at) return true;
    const relation = xauUsidxVote(klines.slice(0, event.i + 1), usidx.filter((bar) => Number(bar.t) <= Number(at.t)));
    if (!relation.active) return true;
    if (relation.vote !== event.dir) return false;
    event.macro = relation;
    event.lab = (event.lab || event.kind || '信号') + ' · USD同向';
    return true;
  });
}

export function collectSignalEvents(klines) {
  const out = [];
  if (!klines || !klines.length) return out;
  const n = klines.length;

  const hold = getHold(klines);
  (hold && hold.marks || []).forEach((mk) => {
    if (!mk || mk.status !== 'trigger') return;
    pushSig(out, {
      i: mk.i,
      t: klines[mk.i] && klines[mk.i].t,
      dir: mk.dir,
      kind: 'hold',
      lab: mk.lab || (mk.dir > 0 ? '企稳' : '受阻'),
      price: mk.price,
    });
  });

  const trap = getTrap(klines);
  if (trap && trap.status === 'trigger' && trap.recI != null && trap.recI >= 0) {
    pushSig(out, {
      i: trap.recI,
      t: klines[trap.recI] && klines[trap.recI].t,
      dir: trap.dir,
      kind: 'trap',
      lab: trap.title || (trap.dir > 0 ? '诱空收回' : '诱多收回'),
      price: trap.level,
    });
  }

  const pb = getPb(klines);
  ['bounce', 'pull'].forEach((key) => {
    const pack = pb && pb[key];
    if (!pack || pack.status !== 'trigger') return;
    const i = pack.recI != null && pack.recI >= 0
      ? pack.recI
      : (pack.pbI != null && pack.pbI >= 0 ? pack.pbI : -1);
    if (i < 0) return;
    pushSig(out, {
      i: i,
      t: klines[i] && klines[i].t,
      dir: pack.dir,
      kind: key,
      lab: pack.title || pack.label || (key === 'bounce' ? (pack.dir > 0 ? '反弹' : '回落') : (pack.dir > 0 ? '回踩' : '反抽')),
      price: pack.target,
    });
  });

  const smc = getSmc(klines);
  (smc && smc.signals || []).forEach((sig) => {
    if (!sig || sig.status !== 'trigger') return;
    pushSig(out, {
      i: sig.i,
      t: klines[sig.i] && klines[sig.i].t,
      dir: sig.dir,
      kind: 'smc',
      lab: sig.title || ((sig.eventKind || 'SMC') + (sig.dir > 0 ? ' 多' : ' 空')),
      price: sig.poi && (sig.poi.mid != null ? sig.poi.mid : sig.poi.bot),
    });
  });
  (smc && smc.events || []).forEach((ev) => {
    if (!ev || ev.i == null) return;
    pushSig(out, {
      i: ev.i,
      t: klines[ev.i] && klines[ev.i].t,
      dir: ev.dir,
      kind: 'bos',
      lab: (ev.kind || 'BOS') + (ev.dir > 0 ? ' 多' : ' 空'),
      price: ev.price,
    });
  });

  const stack = getStack();
  if (stack && stack.status === 'trigger') {
    const i = stackMarkIndex(klines, stack.t || (klines[n - 1] && klines[n - 1].t));
    if (i != null && i >= 0) {
      pushSig(out, {
        i: i,
        t: klines[i] && klines[i].t,
        dir: stack.dir || stack.vote || 0,
        kind: 'stack',
        lab: stack.title || stack.label || '套轨',
        price: null,
      });
    }
  }

  const hkld = getHkld(klines);
  (hkld && hkld.marks || []).forEach((mk) => {
    if (!mk || mk.status !== 'trigger') return;
    pushSig(out, {
      i: mk.i,
      t: klines[mk.i] && klines[mk.i].t,
      dir: mk.dir,
      kind: 'hkld',
      lab: mk.label || mk.lab || '高空低多',
      price: mk.px != null ? mk.px : mk.price,
    });
  });

  const fib = getFib(klines);
  if (fib && fib.status === 'trigger') {
    const i = Math.max(0, n - 1 - (fib.forming ? 1 : 0));
    pushSig(out, {
      i: i,
      t: klines[i] && klines[i].t,
      dir: fib.vote || fib.dir || 0,
      kind: 'fib',
      lab: fib.title || fib.label || '斐波那契',
      price: fib.hit && fib.hit.price,
    });
  }

  const st = getSuperTrend(klines);
  (st && st.flips || []).forEach((fl) => {
    if (!fl || fl.i == null) return;
    pushSig(out, {
      i: fl.i,
      t: klines[fl.i] && klines[fl.i].t,
      dir: fl.dir,
      kind: 'st',
      lab: fl.dir > 0 ? '超级趋势转多' : '超级趋势转空',
      price: fl.price,
    });
  });

  const box = getBox(klines);
  if (box && box.ok && box.breakI != null && box.breakI >= 0) {
    pushSig(out, {
      i: box.breakI,
      t: klines[box.breakI] && klines[box.breakI].t,
      dir: box.dir,
      kind: 'box',
      lab: box.dir > 0 ? '箱体上破' : '箱体下破',
      price: box.dir > 0 ? box.top : box.bottom,
    });
  }

  const sr = getSr(klines);
  (sr && sr.levels || []).forEach((lv) => {
    if (!lv || lv.breakI == null) return;
    if (n - 1 - lv.breakI > 3) return;
    const bearish = lv.orig === 'sup' || lv.role === 'sup';
    pushSig(out, {
      i: lv.breakI,
      t: klines[lv.breakI] && klines[lv.breakI].t,
      dir: bearish ? -1 : 1,
      kind: 'sr',
      lab: (bearish ? '破支撑' : '破压力') + (lv.price != null ? ' ' + px(lv.price) : ''),
      price: lv.price,
    });
  });

  (state.fastMarks || []).forEach((mk) => {
    if (!mk || mk.t == null) return;
    let i = -1;
    for (let j = n - 1; j >= 0; j--) {
      if (klines[j].t === mk.t || Math.abs(klines[j].t - mk.t) < 2) { i = j; break; }
      if (klines[j].t < mk.t - 120) break;
    }
    if (i < 0) return;
    pushSig(out, {
      i: i,
      t: mk.t,
      dir: mk.dir,
      kind: 'open',
      lab: mk.dir > 0 ? '开多' : '开空',
      price: null,
    });
  });

  return matchSignalsToFactors(dedupeSigs(out), klines, state.usidxBars);
}

export function drawSignalRail(svg, klines, vis, view, xForIndex) {
  if (!state.sigRail) return;
  if (!svg || !klines || !klines.length || !vis || !vis.length) return;
  const events = collectSignalEvents(klines);
  const start = view.start;
  const end = view.start + view.count;
  const visible = events.filter((e) => e.i >= start && e.i < end);
  state._sigEvents = events;
  if (!visible.length) {
    state._sigHover = null;
    syncSigTip(null);
    return;
  }

  const g = svgEl('g', { class: 'sig-rail-g', 'aria-hidden': 'true' });
  const yBase = H - 18;
  g.appendChild(svgEl('line', {
    x1: PAD.l, x2: W - PAD.r, y1: yBase, y2: yBase,
    stroke: 'rgba(15,35,34,.14)', 'stroke-width': '1',
  }));
  g.appendChild(svgEl('line', {
    id: 'ck-sig-guide',
    x1: PAD.l, x2: PAD.l, y1: PAD.t, y2: yBase,
    stroke: 'var(--accent)', 'stroke-width': '1',
    'stroke-dasharray': '3 4', opacity: '.48',
    'pointer-events': 'none', visibility: 'hidden',
  }));

  const byIndex = Object.create(null);
  visible.forEach((e) => {
    if (!byIndex[e.i]) byIndex[e.i] = [];
    byIndex[e.i].push(e);
  });

  Object.keys(byIndex).forEach((key) => {
    const pack = byIndex[key];
    const xc = xForIndex(Number(key));
    pack.forEach((e, idx) => {
      const y = yBase - idx * 5;
      const fill = e.dir > 0 ? 'var(--up)' : (e.dir < 0 ? 'var(--down)' : 'var(--warn)');
      const lab = String(e.lab || '').replace(/[<>&"']/g, '');
      g.appendChild(svgEl('circle', {
        cx: xc, cy: y, r: idx === 0 ? 3.2 : 2.4,
        fill: fill, stroke: 'var(--bg)', 'stroke-width': '1',
        class: 'sig-dot',
        'pointer-events': 'all',
        'data-sig-i': String(e.i),
        'data-sig-lab': lab,
        'data-sig-kind': e.kind || '',
        'data-sig-dir': String(e.dir || 0),
        'data-sig-t': String(e.t || ''),
        'data-sig-px': e.price != null ? String(e.price) : '',
        'data-sig-slot': String(idx),
      }));
    });
  });
  svg.appendChild(g);
  if (state._sigHover && byIndex[state._sigHover.i]) {
    syncSigGuide({
      x: xForIndex(state._sigHover.i),
      y: yBase - (Number(state._sigHover.slot) || 0) * 5,
    });
  } else if (state._sigHover) {
    state._sigHover = null;
    syncSigTip(null);
  }
}

export function syncSigGuide(point) {
  const guide = $('ck-sig-guide');
  if (!guide) return;
  const x = point && Number(point.x);
  const y = point && Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    guide.setAttribute('visibility', 'hidden');
    return;
  }
  guide.setAttribute('x1', String(x));
  guide.setAttribute('x2', String(x));
  guide.setAttribute('y1', String(PAD.t));
  guide.setAttribute('y2', String(y));
  guide.setAttribute('visibility', 'visible');
}

export function syncSigTip(payload) {
  const tip = $('sigTip');
  if (!tip) return;
  if (!payload) {
    tip.hidden = true;
    tip.textContent = '';
    return;
  }
  const tLab = payload.t
    ? (state.tf === '1d' || state.tf === '4h' || state.tf === '1h' ? fmtBarTime(payload.t) : fmtHm(payload.t))
    : '--';
  const dirLab = payload.dir > 0 ? '多' : (payload.dir < 0 ? '空' : '中');
  const pxLab = payload.price != null && Number.isFinite(Number(payload.price))
    ? (' · ' + px(Number(payload.price)))
    : '';
  tip.hidden = false;
  tip.textContent = tLab + ' · ' + (payload.lab || payload.kind || '信号') + ' · ' + dirLab + pxLab;
}

export function renderSigChrome() {
  const rail = $('sigRail');
  if (rail) rail.hidden = !state.sigRail;
  const btn = $('btnSigRail');
  if (btn) btn.setAttribute('aria-pressed', String(!!state.sigRail));
  if (!state.sigRail) {
    state._sigHover = null;
    syncSigTip(null);
    syncSigGuide(null);
  }
}

export function bindSignalRail(onJump) {
  const wrap = $('chartWrap');
  if (!wrap || wrap._sigBound) return;
  wrap._sigBound = true;
  wrap.addEventListener('pointermove', (e) => {
    if (!state.sigRail) return;
    const t = e.target;
    if (!t || !t.getAttribute || t.getAttribute('data-sig-i') == null) {
      if (state._sigHover) {
        state._sigHover = null;
        syncSigTip(null);
        syncSigGuide(null);
      }
      return;
    }
    const payload = {
      i: Number(t.getAttribute('data-sig-i')),
      lab: t.getAttribute('data-sig-lab') || '',
      kind: t.getAttribute('data-sig-kind') || '',
      dir: Number(t.getAttribute('data-sig-dir') || 0),
      t: Number(t.getAttribute('data-sig-t') || 0) || null,
      price: t.getAttribute('data-sig-px') ? Number(t.getAttribute('data-sig-px')) : null,
      slot: Number(t.getAttribute('data-sig-slot') || 0),
    };
    state._sigHover = payload;
    syncSigTip(payload);
    syncSigGuide({
      x: Number(t.getAttribute('cx')),
      y: Number(t.getAttribute('cy')),
    });
  });
  wrap.addEventListener('pointerleave', () => {
    state._sigHover = null;
    syncSigTip(null);
    syncSigGuide(null);
  });
  wrap.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.getAttribute || t.getAttribute('data-sig-i') == null) return;
    const i = Number(t.getAttribute('data-sig-i'));
    if (!Number.isFinite(i) || typeof onJump !== 'function') return;
    onJump(i);
  });
}
