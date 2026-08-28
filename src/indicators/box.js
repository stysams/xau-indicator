import { px } from '../core/format.js';
import { atr } from '../core/math.js';
import { state } from '../state.js';

export function boxEmpty(len, why) {
  return {
    ok: false, len: len, status: 'none', dir: 0, statusLab: '未现',
    top: null, bottom: null, mid: null, height: 0,
    topTouches: 0, botTouches: 0, topSwings: 0, botSwings: 0,
    boxStart: -1, lastTopAt: -1, lastBotAt: -1, breakI: -1, touches: [],
    pos: null, posLab: '未现',
    label: '箱体未现', title: '箱体震荡', why: why,
    sig: '',
  };
}

// 箱体震荡：用摆动高低点聚类出近端横向箱体，标出上下沿、触碰次数与破位状态。
// 在趋势行情里摆动点不成簇、或上下沿触碰不足时，返回 ok=false（箱体未现）。
export function computeBox(klines) {
  const len = state.boxLen || 120;
  const none = (why) => boxEmpty(len, why);
  if (!klines || klines.length < 24) return none('箱体需要至少 24 根 K 线。');
  const n = klines.length;
  const lookback = Math.min(len, n);
  const start = n - lookback;
  const last = klines[n - 1];
  const atrv = atr(klines, 14) || Math.max(last.c * 0.0005, 1e-6);
  const floor = Math.max(atrv, last.c * 0.0005);
  const radius = Math.max(floor * 0.6, last.c * 0.00018);
  const minH = Math.max(floor * 1.1, last.c * 0.0005);
  const maxH = Math.max(floor * 5.0, minH * 1.6);

  // 摆动点（k=2 分形，与 core/math 的 swings 口径一致）
  const highs = [], lows = [];
  for (let i = start + 2; i < n - 2; i++) {
    const k = klines[i];
    const a2 = klines[i - 2], a1 = klines[i - 1], b1 = klines[i + 1], b2 = klines[i + 2];
    if (k.h > a1.h && k.h >= a2.h && k.h > b1.h && k.h >= b2.h) highs.push({ i: i, price: k.h });
    if (k.l < a1.l && k.l <= a2.l && k.l < b1.l && k.l <= b2.l) lows.push({ i: i, price: k.l });
  }
  if (highs.length < 2 || lows.length < 2) {
    return none('箱体需要至少两个摆动高点与两个摆动低点来确认上下沿。');
  }

  // 按价格就近聚类
  function clusters(points) {
    const out = [];
    const sorted = points.slice().sort((a, b) => a.price - b.price);
    let cur = null;
    sorted.forEach((p) => {
      if (!cur || p.price - cur.sum / cur.cnt > radius) {
        if (cur) out.push(cur);
        cur = { sum: p.price, cnt: 1, maxI: p.i, minI: p.i, pts: [p] };
      } else {
        cur.sum += p.price;
        cur.cnt += 1;
        cur.maxI = Math.max(cur.maxI, p.i);
        cur.minI = Math.min(cur.minI, p.i);
        cur.pts.push(p);
      }
    });
    if (cur) out.push(cur);
    return out;
  }
  const tops = clusters(highs).filter((c) => c.cnt >= 2);
  const bots = clusters(lows).filter((c) => c.cnt >= 2);
  if (!tops.length || !bots.length) {
    return none('箱体的上沿或下沿还没有两次以上的触碰。');
  }

  // 选一组既有触碰又够近期的上下沿组合
  let best = null;
  let bestScore = -1;
  const recentCap = Math.min(40, lookback * 0.4);
  tops.forEach((t) => {
    bots.forEach((b) => {
      const topPx = t.sum / t.cnt;
      const botPx = b.sum / b.cnt;
      if (botPx >= topPx) return;
      const h = topPx - botPx;
      if (h < minH || h > maxH) return;
      const lastTouch = Math.max(t.maxI, b.maxI);
      const recency = n - 1 - lastTouch;
      if (recency > recentCap) return;
      const score = (t.cnt + b.cnt) * 4 - recency;
      if (score > bestScore) {
        bestScore = score;
        best = { t: t, b: b, topPx: topPx, botPx: botPx, h: h, recency: recency, lastTouch: lastTouch };
      }
    });
  });
  if (!best) {
    return none('近端没有形成可用的横向箱体（上下沿触碰不足或区间过宽）。');
  }

  const topPx = best.topPx, botPx = best.botPx;
  // 箱体起点先取上下沿最早的摆动点，再向左扩展，把仍然落在区间内的 K 一起纳入
  let boxStart = Math.min(best.t.minI, best.b.minI);
  while (boxStart > start) {
    const k = klines[boxStart - 1];
    if (k.h > topPx + radius || k.l < botPx - radius) break;
    boxStart -= 1;
  }
  let topTouch = 0, botTouch = 0, lastTopAt = -1, lastBotAt = -1;
  const touches = [];
  for (let i = boxStart; i < n; i++) {
    const k = klines[i];
    if (k.h >= topPx - radius && k.h <= topPx + radius) {
      topTouch += 1;
      lastTopAt = i;
      touches.push({ i: i, side: 1, price: k.h });
    }
    if (k.l <= botPx + radius && k.l >= botPx - radius) {
      botTouch += 1;
      lastBotAt = i;
      touches.push({ i: i, side: -1, price: k.l });
    }
  }
  const mid = (topPx + botPx) / 2;
  const close = last.c;
  const breakout = Math.max(atrv * 0.4, best.h * 0.06);

  // 破位起点：从末根往前找连续留在边缘之外的第一根，避免指向中途扫一下又收回的那根
  function breakFrom(side) {
    let i = n - 1;
    while (i > boxStart) {
      const c = klines[i - 1].c;
      if (side > 0 ? c > topPx + breakout : c < botPx - breakout) i -= 1;
      else break;
    }
    return i;
  }

  let status, dir, statusLab, pos, posLab, why;
  let breakI = -1;
  const base = {
    ok: true, len: lookback, top: topPx, bottom: botPx, mid: mid, height: best.h,
    topTouches: topTouch, botTouches: botTouch, topSwings: best.t.cnt, botSwings: best.b.cnt,
    boxStart: boxStart, lastTopAt: lastTopAt, lastBotAt: lastBotAt,
    touches: touches.slice(-14),
    atrv: atrv, radius: radius, breakout: breakout,
    label: '箱体震荡', title: '箱体震荡',
    sig: [topPx.toFixed(4), botPx.toFixed(4), boxStart, 'range'].join(':'),
  };
  if (close > topPx + breakout) {
    status = 'breakUp'; dir = 1; statusLab = '上破'; pos = null; posLab = '上破';
    breakI = breakFrom(1);
    why = '收盘站上箱体上沿 ' + px(topPx) + '，箱体震荡结束，按向上突破看待。只描述结构，不是下单指令。';
    base.sig = [topPx.toFixed(4), botPx.toFixed(4), boxStart, 'breakUp', breakI].join(':');
  } else if (close < botPx - breakout) {
    status = 'breakDn'; dir = -1; statusLab = '下破'; pos = null; posLab = '下破';
    breakI = breakFrom(-1);
    why = '收盘跌破箱体下沿 ' + px(botPx) + '，箱体震荡结束，按向下突破看待。只描述结构，不是下单指令。';
    base.sig = [topPx.toFixed(4), botPx.toFixed(4), boxStart, 'breakDn', breakI].join(':');
  } else {
    status = 'range'; dir = 0; statusLab = '震荡中';
    pos = (close - botPx) / best.h;
    posLab = pos <= 0.2 ? '贴近下沿' : pos >= 0.8 ? '贴近上沿' : '中轴附近';
    why = '现价在箱体 ' + px(botPx) + '–' + px(topPx) + ' 之间' +
      (posLab === '中轴附近' ? '' : ('，' + posLab)) +
      '，上下沿各有触碰。区间内来回，等边缘出现收回迹象再按信号开枪。只描述结构，不是下单指令。';
  }

  return Object.assign(base, {
    status: status, dir: dir, statusLab: statusLab, pos: pos, posLab: posLab, why: why,
    breakI: breakI,
  });
}

export function getBox(klines) {
  const last = klines && klines[klines.length - 1];
  const key = [
    klines && klines.length, last && last.t,
    last && last.c, last && last.h, last && last.l,
    state.tf, state.boxLen,
  ].join(':');
  if (state._boxKey === key && state._box) return state._box;
  const pack = computeBox(klines);
  state._boxKey = key;
  state._box = pack;
  return pack;
}
