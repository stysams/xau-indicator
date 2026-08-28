import { px } from '../core/format.js';
import { state } from '../state.js';

export function stEmpty(period, mult) {
  return {
    ok: false, period: period, mult: mult,
    status: 'none', label: '样本不足', title: '超级趋势',
    why: '超级趋势需要至少 ' + (period + 2) + ' 根 K 线。',
    st: [], dir: [], up: [], dn: [], flips: [], last: null, lastDir: 0, flipAt: -1,
  };
}

// 超级趋势：以 ATR 包络做趋势跟踪，收盘穿越后换向。
// st/up/dn 三个序列与 klines 下标一一对应；up 只在多头段有值，dn 只在空头段有值。
export function computeSuperTrend(klines) {
  const period = state.stN || 10;
  const mult = state.stK || 3;
  if (!klines || klines.length < period + 2) return stEmpty(period, mult);
  const n = klines.length;
  const st = new Array(n).fill(null);
  const dir = new Array(n).fill(0);

  // Wilder ATR 序列，与下标对齐
  const atrArr = new Array(n).fill(null);
  {
    const trs = new Array(n).fill(0);
    trs[0] = klines[0].h - klines[0].l;
    for (let i = 1; i < n; i++) {
      const c = klines[i], p = klines[i - 1];
      trs[i] = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    }
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += trs[i];
    let a = sum / period;
    atrArr[period] = a;
    for (let i = period + 1; i < n; i++) {
      a = (a * (period - 1) + trs[i]) / period;
      atrArr[i] = a;
    }
  }

  let prevUp = null, prevDn = null;
  // 首根按收盘相对中价定初始方向，之后沿用前一根方向，直到收盘穿越
  let prevDir = klines[period].c >= (klines[period].h + klines[period].l) / 2 ? 1 : -1;
  for (let i = period; i < n; i++) {
    const k = klines[i];
    const hl2 = (k.h + k.l) / 2;
    const at = atrArr[i];
    let up = hl2 + mult * at;
    let dn = hl2 - mult * at;
    if (prevUp != null) {
      // 平滑：前收在带上沿上方时上轨只升不降，否则只降不升；下轨对称
      if (!(up < prevUp || klines[i - 1].c > prevUp)) up = prevUp;
      if (!(dn > prevDn || klines[i - 1].c < prevDn)) dn = prevDn;
    }
    let d = prevDir;
    if (prevUp != null) {
      if (k.c > prevUp) d = 1;
      else if (k.c < prevDn) d = -1;
    }
    dir[i] = d;
    st[i] = d > 0 ? dn : up;
    prevUp = up;
    prevDn = dn;
    prevDir = d;
  }

  const up = new Array(n).fill(null);
  const dn = new Array(n).fill(null);
  const flips = [];
  for (let i = 0; i < n; i++) {
    if (dir[i] > 0) up[i] = st[i];
    else if (dir[i] < 0) dn[i] = st[i];
    if (i > period && dir[i] && dir[i - 1] && dir[i] !== dir[i - 1]) {
      flips.push({ i: i, dir: dir[i], price: st[i], close: klines[i].c });
    }
  }
  const lastDir = dir[n - 1];
  const last = st[n - 1];
  const lastFlip = flips.length ? flips[flips.length - 1] : null;
  return {
    ok: true, period: period, mult: mult, st: st, dir: dir, up: up, dn: dn,
    flips: flips.slice(-6), flipAt: lastFlip ? lastFlip.i : -1,
    barsSinceFlip: lastFlip ? (n - 1 - lastFlip.i) : null,
    last: last, lastDir: lastDir,
    status: lastDir > 0 ? 'up' : (lastDir < 0 ? 'down' : 'none'),
    label: lastDir > 0 ? '超级趋势 · 多' : (lastDir < 0 ? '超级趋势 · 空' : '超级趋势'),
    title: '超级趋势',
    why: lastDir > 0
      ? ('ST' + period + '×' + mult + ' 在价格下方运行，趋势偏多；收盘跌破 ' + px(last) + ' 才转空。只描述结构，不是下单指令。')
      : lastDir < 0
        ? ('ST' + period + '×' + mult + ' 在价格上方运行，趋势偏空；收盘站上 ' + px(last) + ' 才转多。只描述结构，不是下单指令。')
        : '超级趋势样本不足。',
  };
}

export function getSuperTrend(klines) {
  const last = klines && klines[klines.length - 1];
  const key = [
    klines && klines.length, last && last.t,
    last && last.o, last && last.h, last && last.l, last && last.c,
    state.tf, state.stN, state.stK,
  ].join(':');
  if (state._stKey === key && state._st) return state._st;
  const pack = computeSuperTrend(klines);
  state._stKey = key;
  state._st = pack;
  return pack;
}
