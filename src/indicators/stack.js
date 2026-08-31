import { klinesClosed, stackSrc } from '../core/bars.js';
import { n } from '../core/format.js';
import { bollCore } from '../core/math.js';
import { analyzeBoll } from './boll.js';
import { $, state } from '../state.js';

export const STACK_TFS = [
  { id: '1h', name: '1小时' },
  { id: '15m', name: '15分' },
  { id: '5m', name: '5分' },
  { id: '1m', name: '1分' },
];

export const STACK_GLOSS = [
  { lab: '偏多', cls: 'up', mean: '1 小时布林走在多头一侧，大周期趋势向上。' },
  { lab: '偏空', cls: 'dn', mean: '1 小时布林走在空头一侧，大周期趋势向下。' },
  { lab: '纠缠', cls: 'mid', mean: '1 小时和 15 分钟方向对打，先等大周期对齐。' },
  { lab: '挤压', cls: 'mid', mean: '大周期带宽收窄，波动被压住，先等开口，不猜方向。' },
  { lab: '宽幅', cls: 'mid', mean: '1 小时带宽偏宽且不是走轨，按回归而不是趋势。' },
  { lab: '走平', cls: 'mid', mean: '1 小时没有方向，中性观望。' },
];

export function stackWalk(ph, dir) {
  if (!ph) return false;
  return dir > 0 ? ph.id === 'walk_up' : ph.id === 'walk_dn';
}

export function stackPull(ph, dir) {
  if (!ph) return false;
  return dir > 0 ? (ph.id === 'pull_up' || ph.id === 'side_up') : (ph.id === 'pull_dn' || ph.id === 'side_dn');
}

export function stackOpen(ph, dir) {
  if (!ph) return false;
  return dir > 0 ? ph.id === 'open_up' : ph.id === 'open_dn';
}

export function stackSame(ph, dir) {
  if (!ph || !ph.ok || !dir) return false;
  if (dir > 0) return ph.dir > 0 && ph.id !== 'fade_up';
  return ph.dir < 0 && ph.id !== 'fade_dn';
}

export function stackFade(ph, dir) {
  if (!ph) return false;
  return dir > 0 ? ph.id === 'fade_dn' : ph.id === 'fade_up';
}

export function stackAgainstFade(ph, dir) {
  if (!ph) return false;
  return dir > 0 ? ph.id === 'fade_up' : ph.id === 'fade_dn';
}

export function stackExpanding(ph, dir) {
  if (!ph || !ph.ok) return false;
  if (stackOpen(ph, dir) || stackWalk(ph, dir)) return true;
  return !!(ph.expandingFromSqueeze && ph.shape === '开口' && ph.dir === dir);
}

export function stackLayer(klines, meta) {
  const empty = {
    ok: false, id: 'none', lab: '样本不足', dir: 0,
    name: meta.name, tf: meta.id, lastPb: null, lastUp: null, lastMid: null, lastDn: null,
    bwRank: null, lastBw: null,
    squeeze: false, wide: false, reclaimUp: false, reclaimDn: false,
    expandingFromSqueeze: false, shape: '', t: null, n: klines ? klines.length : 0,
  };
  const b = analyzeBoll(klines);
  if (!b.ok) return empty;
  const n = klines.length;
  const last = n - 1;
  const period = b.period || 20;
  const core = bollCore(klines.map((k) => k.c), period);
  const i8 = Math.max(period - 1, last - 8);
  const midSlope = (core.mid[last] != null && core.mid[i8] != null) ? (core.mid[last] - core.mid[i8]) : 0;
  const half = (core.sd[last] || 0) * (b.kMul || 2);
  const slopeUp = midSlope > half * 0.08;
  const slopeDn = midSlope < -half * 0.08;
  let walkUpN = 0, walkDnN = 0;
  for (let i = Math.max(period - 1, last - 2); i <= last; i++) {
    const p = b.pb[i];
    if (p == null) continue;
    if (p >= 0.80) walkUpN++;
    if (p <= 0.20) walkDnN++;
  }
  const walkUp = walkUpN >= 3 && slopeUp;
  const walkDn = walkDnN >= 3 && slopeDn;
  const squeeze = b.bwRank != null && b.bwRank <= 0.20;
  const wide = b.bwRank != null && b.bwRank >= 0.70;
  const pb = b.lastPb;
  let id = 'chop';
  let lab = '中性';
  let dir = 0;
  if (walkUp) { id = 'walk_up'; lab = '走轨上'; dir = 1; }
  else if (walkDn) { id = 'walk_dn'; lab = '走轨下'; dir = -1; }
  else if (squeeze && b.expandingFromSqueeze && b.shape === '开口' && pb != null && pb >= 0.55) {
    id = 'open_up'; lab = '开口上'; dir = 1;
  } else if (squeeze && b.expandingFromSqueeze && b.shape === '开口' && pb != null && pb <= 0.45) {
    id = 'open_dn'; lab = '开口下'; dir = -1;
  } else if (squeeze) { id = 'squeeze'; lab = '挤压'; dir = 0; }
  else if (b.reclaimUp) { id = 'fade_up'; lab = '外收上'; dir = -1; }
  else if (b.reclaimDn) { id = 'fade_dn'; lab = '外收下'; dir = 1; }
  else if (slopeUp && pb != null && pb >= 0.35 && pb <= 0.62) { id = 'pull_up'; lab = '回中上'; dir = 1; }
  else if (slopeDn && pb != null && pb >= 0.38 && pb <= 0.65) { id = 'pull_dn'; lab = '回中下'; dir = -1; }
  else if (wide) { id = 'revert'; lab = '宽轨'; dir = 0; }
  else if (pb != null && pb > 0.55 && (slopeUp || pb >= 0.62)) { id = 'side_up'; lab = '中上'; dir = 1; }
  else if (pb != null && pb < 0.45 && (slopeDn || pb <= 0.38)) { id = 'side_dn'; lab = '中下'; dir = -1; }
  const lastBar = klines[last];
  return {
    ok: true, id: id, lab: lab, dir: dir,
    name: meta.name, tf: meta.id,
    lastPb: pb, lastUp: b.lastUp, lastMid: b.lastMid, lastDn: b.lastDn,
    bwRank: b.bwRank, lastBw: b.lastBw, shape: b.shape,
    squeeze: squeeze, wide: wide, slopeUp: slopeUp, slopeDn: slopeDn,
    reclaimUp: !!b.reclaimUp, reclaimDn: !!b.reclaimDn,
    expandingFromSqueeze: !!b.expandingFromSqueeze,
    t: lastBar && lastBar.t, c: lastBar && lastBar.c, n: n,
  };
}

export function stackTrend(layers) {
  const h = layers && layers['1h'];
  const q = layers && layers['15m'];
  if (!h || !h.ok) {
    return { dir: 0, lab: '看不清', why: '1小时布林样本不足', cls: 'mid', weak: true };
  }
  if (h.id === 'squeeze' && (!q || !q.ok || q.id === 'squeeze' || !q.dir)) {
    return { dir: 0, lab: '挤压', why: '1小时带宽收窄' + (q && q.ok ? '，15分' + q.lab : '') + '，先等开口', cls: 'mid', weak: false };
  }
  if (h.id === 'revert') {
    return { dir: 0, lab: '宽幅', why: '1小时带宽偏宽且不是走轨，按回归而不是趋势', cls: 'mid', weak: false };
  }
  if (q && q.ok && h.dir && q.dir && h.dir !== q.dir) {
    return { dir: 0, lab: '纠缠', why: '1小时' + h.lab + '，15分' + q.lab + '，大周期对打', cls: 'mid', weak: false };
  }
  const dir = h.dir || (q && q.dir) || 0;
  if (!dir) {
    return {
      dir: 0,
      lab: '走平',
      why: '1小时' + h.lab + (q && q.ok ? '，15分' + q.lab : ''),
      cls: 'mid',
      weak: true,
    };
  }
  const followed = !!(q && q.ok && stackSame(q, dir));
  return {
    dir: dir,
    lab: dir > 0 ? '偏多' : '偏空',
    why: '1小时' + h.lab + (q && q.ok ? '，15分' + q.lab : '') + (followed ? '' : '，15分还没跟上'),
    cls: dir > 0 ? 'up' : 'dn',
    weak: !followed,
  };
}

export function stackKindText(st) {
  let t = (st && st.title) ? String(st.title) : '';
  t = t.replace(/^预备/, '').replace(/^套轨/, '');
  if (!t) t = '未对齐';
  if (st && st.status === 'watch' && t.indexOf('预备') !== 0) t = '预备' + t;
  return t;
}

export function stackLine(layers) {
  return STACK_TFS.map((x) => {
    const L = layers[x.id];
    return x.name + (L && L.lab ? L.lab : '不足');
  }).join(' · ');
}

export function stackResult(kind, layers, extra) {
  const line = stackLine(layers);
  return Object.assign({
    kind: kind,
    dir: 0,
    vote: 0,
    status: 'none',
    title: '套轨',
    label: '套轨',
    why: extra && extra.why ? extra.why : ('套轨未对齐到具名结构。' + line),
    line: line,
    layers: layers,
    t: layers['1m'] && layers['1m'].t,
  }, extra || {});
}

export function stackCompose(layers) {
  const h = layers['1h'] || { ok: false };
  const q = layers['15m'] || { ok: false };
  const f = layers['5m'] || { ok: false };
  const m = layers['1m'] || { ok: false };
  const line = stackLine(layers);
  if (!h.ok || !q.ok || !f.ok || !m.ok) {
    return stackResult('none', layers, {
      title: '套轨样本不足',
      why: '套轨样本不足，需要 1分、5分、15分、1小时各约 ' + ((state.bollN || 20) + 20) + ' 根已收盘 K 线。',
    });
  }
  if (h.dir && q.dir && h.dir !== q.dir) {
    return stackResult('conflict', layers, {
      title: '套轨不对齐',
      why: '1小时' + h.lab + '，15分' + q.lab + '，大周期对打。' + line,
    });
  }
  if (stackWalk(h, 1) && m.lastPb != null && m.lastPb > 1) {
    return stackResult('stretch', layers, {
      title: '套轨延伸中',
      why: '1小时走轨上，但1分收盘仍在上轨外（%B ' + m.lastPb.toFixed(2) + '），延伸段不加多票。' + line,
    });
  }
  if (stackWalk(h, -1) && m.lastPb != null && m.lastPb < 0) {
    return stackResult('stretch', layers, {
      title: '套轨延伸中',
      why: '1小时走轨下，但1分收盘仍在下轨外（%B ' + m.lastPb.toFixed(2) + '），延伸段不加空票。' + line,
    });
  }
  if (stackWalk(h, 1) && stackWalk(m, 1)) {
    return stackResult('stretch', layers, {
      title: '套轨延伸中',
      why: '1小时走轨上，1分也在走轨，等回中轨，不追。' + line,
    });
  }
  if (stackWalk(h, -1) && stackWalk(m, -1)) {
    return stackResult('stretch', layers, {
      title: '套轨延伸中',
      why: '1小时走轨下，1分也在走轨，等回中轨，不追。' + line,
    });
  }
  if (stackWalk(h, 1) && (stackAgainstFade(q, 1) || stackAgainstFade(f, 1) || stackAgainstFade(m, 1))) {
    return stackResult('conflict', layers, {
      title: '套轨不对齐',
      why: '1小时走轨上，下层却在对外轨做反手收回，按错层处理。' + line,
    });
  }
  if (stackWalk(h, -1) && (stackAgainstFade(q, -1) || stackAgainstFade(f, -1) || stackAgainstFade(m, -1))) {
    return stackResult('conflict', layers, {
      title: '套轨不对齐',
      why: '1小时走轨下，下层却在对外轨做反手收回，按错层处理。' + line,
    });
  }
  if (h.id === 'squeeze' && q.id === 'squeeze' && f.id === 'squeeze' && (m.id === 'squeeze' || m.id === 'chop')) {
    return stackResult('squeeze', layers, {
      title: '套轨挤压',
      why: '四层仍在挤压，只提示等开口，不猜方向。' + line,
    });
  }

  for (let d = 0; d < 2; d++) {
    const dir = d === 0 ? 1 : -1;
    if (!stackWalk(h, dir)) continue;
    if (!(stackWalk(q, dir) || stackPull(q, dir))) continue;
    if (stackAgainstFade(q, dir)) continue;
    if (!(stackSame(f, dir) || stackPull(f, dir) || stackWalk(f, dir))) continue;
    const pb = m.lastPb;
    if (pb == null) continue;
    const midOk = dir > 0 ? (pb >= 0.48 && pb <= 0.62) : (pb <= 0.52 && pb >= 0.38);
    const tagged = dir > 0
      ? (m.id === 'pull_up' || (pb >= 0.35 && pb <= 0.62))
      : (m.id === 'pull_dn' || (pb <= 0.65 && pb >= 0.38));
    if (!midOk || !tagged) continue;
    const side = dir > 0 ? '多' : '空';
    return stackResult('pull', layers, {
      dir: dir,
      vote: dir,
      status: 'trigger',
      title: '套轨顺势回中' + side,
      label: '回中' + side,
      why: '1小时走轨' + (dir > 0 ? '上' : '下') + '，15分' + q.lab + '，5分' + f.lab + '，1分回到中轨一带（%B ' + pb.toFixed(2) + '）并站回这一侧。只描述结构对齐，不是下单指令。',
    });
  }

  for (let d = 0; d < 2; d++) {
    const dir = d === 0 ? 1 : -1;
    if (stackWalk(h, -dir) || stackWalk(q, -dir)) continue;
    const htfSqueeze = h.id === 'squeeze' || q.id === 'squeeze' || stackOpen(h, dir) || stackOpen(q, dir);
    if (!htfSqueeze) continue;
    const m5open = stackExpanding(f, dir);
    const m1open = stackExpanding(m, dir);
    if (m1open && !m5open) {
      const side = dir > 0 ? '上' : '下';
      return stackResult('open', layers, {
        dir: dir,
        vote: 0,
        status: 'watch',
        title: '套轨开口观察',
        label: '开口?',
        why: '1分已经开口' + side + '，5分还没同向开口，先防假突破。' + line,
      });
    }
    if (m1open && m5open) {
      const side = dir > 0 ? '多' : '空';
      const from = (h.id === 'squeeze' || stackOpen(h, dir)) ? '1小时' : '15分';
      return stackResult('open', layers, {
        dir: dir,
        vote: dir,
        status: 'trigger',
        title: '套轨开口' + side,
        label: '开口' + side,
        why: from + '挤压或开口后，5分与1分同向开口。只描述结构对齐，不是下单指令。',
      });
    }
  }

  if (h.id === 'revert') {
    for (let d = 0; d < 2; d++) {
      const dir = d === 0 ? 1 : -1;
      if (stackWalk(q, -dir)) continue;
      const fadeOk = stackFade(q, dir) || stackFade(f, dir) || stackFade(m, dir);
      const recOk = dir > 0 ? (m.reclaimDn || f.reclaimDn) : (m.reclaimUp || f.reclaimUp);
      if (!fadeOk || !recOk) continue;
      const side = dir > 0 ? '多' : '空';
      return stackResult('fade', layers, {
        dir: dir,
        vote: dir,
        status: 'trigger',
        title: '套轨宽轨收回' + side,
        label: '外收' + side,
        why: '1小时带宽偏宽且不是走轨，下层刺破后收回。只在大周期允许回归时计票，不是下单指令。',
      });
    }
  }

  return stackResult('none', layers, {
    title: '套轨未对齐',
    why: '套轨未对齐到具名结构。' + line,
  });
}

export function stackAsWatch(sig) {
  if (!sig || !sig.dir) return sig;
  const title = sig.title || '套轨';
  const label = sig.label || '套轨';
  return Object.assign({}, sig, {
    vote: 0,
    status: 'watch',
    title: title.indexOf('预备') === 0 ? title : ('预备' + title),
    label: /[?？]$/.test(label) ? label : (label + '?'),
    why: (sig.why || '') + ( /正在走的1分|还要等/.test(sig.why || '') ? '' : '正在走的1分只观察，收盘才确认。'),
  });
}

export function computeStack() {
  const layers = {};
  STACK_TFS.forEach((x) => {
    layers[x.id] = stackLayer(klinesClosed(stackSrc(x.id), x.id), x);
  });
  const closed = stackCompose(layers);
  const live1m = stackLayer(stackSrc('1m'), { id: '1m', name: '1分' });
  const live = stackCompose(Object.assign({}, layers, { '1m': live1m }));
  let sig = closed;
  if (!closed.vote && live.vote) sig = stackAsWatch(live);
  else if (!closed.vote && live.status === 'watch' && live.kind === 'open') sig = live;
  sig.layers = layers;
  sig.live1m = live1m;
  sig.trend = stackTrend(layers);
  return sig;
}

export function getStack() {
  const m1 = stackSrc('1m');
  const m5 = stackSrc('5m');
  const m15 = stackSrc('15m');
  const h1 = stackSrc('1h');
  const last = function (xs) { return xs && xs.length ? xs[xs.length - 1] : null; };
  const a = last(m1), b = last(m5), c = last(m15), d = last(h1);
  const key = [
    m1.length, a && a.t, a && a.o, a && a.h, a && a.l, a && a.c,
    m5.length, b && b.t, b && b.o, b && b.h, b && b.l, b && b.c,
    m15.length, c && c.t, c && c.o, c && c.h, c && c.l, c && c.c,
    h1.length, d && d.t, d && d.o, d && d.h, d && d.l, d && d.c,
    state.bollN, state.bollK, state.tf,
  ].join(':');
  if (state._stackKey === key && state._stack) return state._stack;
  const pack = computeStack();
  state._stackKey = key;
  state._stack = pack;
  return pack;
}

export function stackMarkIndex(klines, t) {
  if (!klines || !klines.length || t == null) return -1;
  let best = 0;
  for (let i = 0; i < klines.length; i++) {
    if (klines[i].t === t) return i;
    if (klines[i].t <= t) best = i;
    else break;
  }
  return best;
}
