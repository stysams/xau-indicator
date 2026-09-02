import { n } from '../core/format.js';
import { ema, macdOf, vwapSeries } from '../core/math.js';
import { macdEvents } from '../indicators/boll.js';
import { getSmc } from '../indicators/smc.js';
import { mkt, state } from '../state.js';

export function vwapVote(klines) {
  if (!klines || klines.length < 2) return { vote: 0, why: '日内均价样本不足' };
  const vw = vwapSeries(klines);
  const last = klines[klines.length - 1].c;
  const line = vw[vw.length - 1];
  const prev = vw[Math.max(0, vw.length - 4)];
  if (line == null || prev == null) return { vote: 0, why: '日内均价尚未形成' };
  const gap = Math.abs(last - line);
  const tol = Math.max(klines[klines.length - 1].h - klines[klines.length - 1].l, last * 0.00008);
  if (gap <= tol) return { vote: 0, why: '现价贴近日内均价，方向不明确' };
  if (last > line && line >= prev) return { vote: 1, why: '现价站上日内均价，均价方向向上' };
  if (last < line && line <= prev) return { vote: -1, why: '现价跌破日内均价，均价方向向下' };
  return { vote: 0, why: last > line ? '现价在日内均价上方，但均价未同步上行' : '现价在日内均价下方，但均价未同步下行' };
}

export function dxyVote(gold, dxy) {
  if (!gold || !dxy || gold.length < 6 || dxy.length < 6) return { vote: 0, why: 'DXY 对照样本不足' };
  const g0 = gold[gold.length - 6].c, g1 = gold[gold.length - 1].c;
  const d0 = dxy[dxy.length - 6].c, d1 = dxy[dxy.length - 1].c;
  if (![g0, g1, d0, d1].every(Number.isFinite) || !d0 || !g0) return { vote: 0, why: 'DXY 对照数据无效' };
  const gr = (g1 - g0) / g0, dr = (d1 - d0) / d0;
  const threshold = 0.00015;
  if (Math.abs(gr) < threshold || Math.abs(dr) < threshold) return { vote: 0, why: '黄金或 DXY 近端变化太小，暂不计票' };
  if (gr > 0 && dr < 0) return { vote: 1, why: '黄金近端走强，DXY 同期走弱，宏观方向暂时配合' };
  if (gr < 0 && dr > 0) return { vote: -1, why: '黄金近端走弱，DXY 同期走强，宏观方向暂时配合' };
  return { vote: 0, why: '黄金与 DXY 同向，传统负相关暂时失效，不加方向票' };
}

// 用同步收盘收益的滚动相关性确认黄金与美元指数的传统负相关关系。
// 相关性只作关系过滤，方向仍由黄金自身的近端收益决定。
export function xauUsidxVote(gold, usidx) {
  if (!gold || !usidx || gold.length < 8 || usidx.length < 8) return { vote: 0, corr: null, why: 'XAU-USIDX 相关性样本不足' };
  const dMap = new Map(usidx.map((b) => [Number(b.t), b.c]));
  const pairs = [];
  gold.forEach((b) => {
    const d = dMap.get(Number(b.t));
    if (Number.isFinite(b.c) && Number.isFinite(d)) pairs.push([b.c, d]);
  });
  const src = pairs.length >= 8 ? pairs.slice(-32) : [];
  if (src.length < 8) return { vote: 0, corr: null, why: 'XAU-USIDX 没有足够同步 K 线' };
  const gr = [], dr = [];
  for (let i = 1; i < src.length; i++) {
    const [gp, dp] = src[i - 1], [gc, dc] = src[i];
    if (!gp || !dp || !Number.isFinite(gc) || !Number.isFinite(dc)) continue;
    gr.push((gc - gp) / gp); dr.push((dc - dp) / dp);
  }
  if (gr.length < 7) return { vote: 0, corr: null, why: 'XAU-USIDX 收益样本不足' };
  const mg = gr.reduce((a, v) => a + v, 0) / gr.length;
  const md = dr.reduce((a, v) => a + v, 0) / dr.length;
  let cov = 0, vg = 0, vd = 0;
  for (let i = 0; i < gr.length; i++) { const a = gr[i] - mg, b = dr[i] - md; cov += a * b; vg += a * a; vd += b * b; }
  const corr = cov / Math.sqrt(vg * vd);
  const gMove = gr[gr.length - 1];
  if (!Number.isFinite(corr) || Math.abs(corr) < 0.25) return { vote: 0, corr, why: 'XAU-USIDX 近期相关性弱，暂不计票' };
  if (corr > -0.25) return { vote: 0, corr, why: 'XAU 与 USIDX 未呈稳定负相关，暂不计票' };
  if (Math.abs(gMove) < 0.00015) return { vote: 0, corr, why: '黄金最新变化太小，相关性暂不转为方向票' };
  return { vote: gMove > 0 ? 1 : -1, corr, why: 'XAU-USIDX 近期负相关（r=' + corr.toFixed(2) + '），黄金' + (gMove > 0 ? '走强' : '走弱') };
}

export function tape(klines) {
  if (klines.length < 3) return { vote: 0, why: '近端 K 线不足三根' };
  const b = klines[klines.length - 2];
  const c = klines[klines.length - 1];
  const range = (c.h - c.l) || 1e-9;
  const body = Math.abs(c.c - c.o);
  const up = c.c >= c.o;
  if (body / range < 0.16) return { vote: 0, why: '近端接近十字星，方向未定' };
  const pb1 = Math.min(b.o, b.c), pb2 = Math.max(b.o, b.c);
  const cb1 = Math.min(c.o, c.c), cb2 = Math.max(c.o, c.c);
  if (cb1 <= pb1 && cb2 >= pb2 && up && b.c < b.o) return { vote: 1, why: '近端阳线吞没前一根阴线' };
  if (cb1 <= pb1 && cb2 >= pb2 && !up && b.c > b.o) return { vote: -1, why: '近端阴线吞没前一根阳线' };
  const last3 = klines.slice(-3);
  const upN = last3.filter((x) => x.c >= x.o).length;
  if (upN === 3) return { vote: 1, why: '近三根连续收阳' };
  if (upN === 0) return { vote: -1, why: '近三根连续收阴' };
  const loWick = Math.min(c.o, c.c) - c.l;
  const hiWick = c.h - Math.max(c.o, c.c);
  if (loWick > body * 2 && loWick > hiWick) return { vote: 1, why: '近端下影线长，买盘回补痕迹' };
  if (hiWick > body * 2 && hiWick > loWick) return { vote: -1, why: '近端上影线长，抛压痕迹' };
  return { vote: 0, why: up ? '近端收阳，力度一般，单根颜色不加方向票' : '近端收阴，力度一般，单根颜色不加方向票' };
}

export function mtfBias(klines) {
  const lean = mtfLean(klines);
  return { vote: lean.vote, label: lean.label, closes: lean.closes, last: lean.last, a: lean.a, b: lean.b };
}

export function mtfLean(klines) {
  if (!klines || klines.length < 21) {
    return { vote: 0, label: '样本不足', stacked: false, closes: [], last: null, a: null, b: null };
  }
  const closes = klines.map((k) => k.c);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const last = closes[closes.length - 1];
  const a = e9[e9.length - 1], b = e21[e21.length - 1];
  const slope = a - e9[Math.max(0, e9.length - 8)];
  let vote = 0;
  if (last > a && a >= b) vote = 1;
  else if (last < a && a <= b) vote = -1;
  else if (last > a && last > b) vote = 1;
  else if (last < a && last < b) vote = -1;
  const stacked = (vote > 0 && a > b && slope > 0) || (vote < 0 && a < b && slope < 0);
  const label = vote > 0 ? '偏多' : vote < 0 ? '偏空' : '纠缠';
  return { vote, label, stacked, closes, last, a, b };
}

export function mtfLadder(tf) {
  const order = [
    { id: '10s', name: '10秒' },
    { id: '1m', name: '1分' },
    { id: '5m', name: '5分' },
    { id: '15m', name: '15分' },
    { id: '1h', name: '1小时' },
    { id: '4h', name: '4小时' },
    { id: '1d', name: '1日' },
  ];
  const i = order.findIndex((x) => x.id === tf);
  if (i < 0) return order.slice(1, 4);
  return order.slice(i + 1, i + 4);
}

export function emaVote(closes) {
  const last = closes[closes.length - 1];
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e55 = ema(closes, 55);
  const a = e9[e9.length - 1];
  const b = e21[e21.length - 1];
  const c = e55[e55.length - 1];
  const slope = a - e9[Math.max(0, e9.length - 8)];
  const has55 = closes.length >= 55;
  let stack = 0;
  if (has55) {
    if (a > b && b > c) stack = 1;
    else if (a < b && b < c) stack = -1;
  } else if (a > b) stack = 1;
  else if (a < b) stack = -1;
  const sl = slope > last * 0.00015 ? 1 : (slope < -last * 0.00015 ? -1 : 0);
  const pos = (last > a && last > b) ? 1 : ((last < a && last < b) ? -1 : 0);
  const parts = [];
  if (has55) parts.push(stack > 0 ? 'EMA9/21/55 多头排列' : stack < 0 ? 'EMA9/21/55 空头排列' : '均线交叉缠绕');
  else parts.push(stack > 0 ? 'EMA9 在 EMA21 之上（55 样本不足）' : stack < 0 ? 'EMA9 在 EMA21 之下（55 样本不足）' : '均线缠绕');
  parts.push(sl > 0 ? 'EMA9 近 8 根向上' : sl < 0 ? 'EMA9 近 8 根向下' : 'EMA9 走平');
  parts.push(pos > 0 ? '现价站上 EMA9 与 EMA21' : pos < 0 ? '现价跌破 EMA9 与 EMA21' : '现价夹在两条均线之间');
  const votes = [stack, sl, pos];
  const bullN = votes.filter((v) => v > 0).length;
  const bearN = votes.filter((v) => v < 0).length;
  let vote = 0;
  if (bullN >= 2 && bearN === 0) vote = 1;
  else if (bearN >= 2 && bullN === 0) vote = -1;
  return {
    vote: vote,
    why: parts.join('。') + (vote === 0 ? '。三项没有同向，不单独给方向票' : ''),
    a: a,
    b: b,
    core: true,
  };
}

export function rsiVote(r, period) {
  period = period || state.rsiN || 14;
  if (r == null) return { vote: 0, why: '样本不够 ' + (period + 1) + ' 根' };
  const t = r.toFixed(1);
  const name = 'RSI' + period + ' ';
  if (r >= 70) return { vote: 0, why: name + t + '，已进超买带，再加多票不合理' };
  if (r >= 60) return { vote: 1, why: name + t + '，动能偏多' };
  if (r <= 30) return { vote: 0, why: name + t + '，已进超卖带，再加空票不合理' };
  if (r <= 40) return { vote: -1, why: name + t + '，动能偏空' };
  return { vote: 0, why: name + t + '，动能中性' };
}

export function bollVote(b) {
  if (!b || !b.ok) return { vote: 0, why: '样本不足，需要更多 K 线' };
  const pbTxt = b.lastPb == null ? '--' : b.lastPb.toFixed(2);
  const bwTxt = b.lastBw == null ? '--' : ((b.lastBw * 100).toFixed(2) + '%');
  if (b.reclaimDn) return { vote: 1, why: '%B ' + pbTxt + '，刺破下轨后收回。带宽 ' + bwTxt };
  if (b.reclaimUp) return { vote: -1, why: '%B ' + pbTxt + '，刺破上轨后收回。带宽 ' + bwTxt };
  if (b.expandingFromSqueeze && b.lastPb != null && b.lastPb >= 0.55) {
    return { vote: 1, why: '挤压后开口向上，%B ' + pbTxt + '，' + b.bwLabel };
  }
  if (b.expandingFromSqueeze && b.lastPb != null && b.lastPb <= 0.45) {
    return { vote: -1, why: '挤压后开口向下，%B ' + pbTxt + '，' + b.bwLabel };
  }
  if (b.lastPb != null && b.lastPb > 1) {
    return { vote: 0, why: '收盘仍在上轨外（%B ' + pbTxt + '），延伸段追多不合理' };
  }
  if (b.lastPb != null && b.lastPb < 0) {
    return { vote: 0, why: '收盘仍在下轨外（%B ' + pbTxt + '），延伸段追空不合理' };
  }
  return { vote: 0, why: '%B ' + pbTxt + '，' + b.touchKind + '；' + b.shape + '，' + b.bwLabel };
}

export function macdVote(klines) {
  const m = macdOf(klines.map((k) => k.c));
  if (!m.hist.length || m.hist[m.hist.length - 1] == null) {
    return { vote: 0, why: 'MACD 样本不够 26 根' };
  }
  const ev = macdEvents(m.dif, m.dea, m.hist);
  const n = klines.length;
  const recent = (i) => i >= 0 && (n - 1 - i) <= 5;
  if (recent(ev.golden)) return { vote: 1, why: '近 5 根内金叉，DIF 上穿 DEA' };
  if (recent(ev.death)) return { vote: -1, why: '近 5 根内死叉，DIF 下穿 DEA' };
  if (ev.lastDif > ev.lastDea && ev.lastHist > 0) return { vote: 1, why: 'DIF 在 DEA 之上，红柱' };
  if (ev.lastDif < ev.lastDea && ev.lastHist < 0) return { vote: -1, why: 'DIF 在 DEA 之下，绿柱' };
  return { vote: 0, why: 'DIF 与 DEA 纠缠' };
}

export function smcVote(klines) {
  if (!klines || klines.length < 8) return { vote: 0, why: '结构样本不足', core: true };
  const smc = getSmc(klines);
  const n = klines.length;
  const last = klines[n - 1];
  const recentN = Math.max(8, Math.round(n * 0.12));
  const lastEv = smc.events && smc.events.length ? smc.events[smc.events.length - 1] : null;
  const age = lastEv ? (n - 1 - lastEv.i) : null;
  const lastRecent = lastEv && age <= recentN;
  const live = smc.live;
  if (live) {
    return { vote: live.vote, why: live.why, core: true, signal: live };
  }
  const recentDone = (smc.signals || []).filter((s) => s.status === 'done' && (n - 1 - s.i) <= recentN);
  if (recentDone.length) {
    const d = recentDone[recentDone.length - 1];
    return { vote: 0, why: d.why, core: true, signal: d };
  }
  let inOb = null;
  (smc.obs || []).forEach((ob) => {
    if (last.l <= ob.top && last.h >= ob.bot) inOb = ob;
  });
  let inFvg = null;
  (smc.fvgs || []).forEach((g) => {
    if (last.c >= g.bot && last.c <= g.top) inFvg = g;
  });
  const extra = [];
  if (inOb) extra.push('现价触及未回补' + (inOb.dir > 0 ? '多头' : '空头') + '订单区块');
  if (inFvg) extra.push('落在未回补' + (inFvg.dir > 0 ? '上行' : '下行') + '缺口');
  const wait = '还不是入场信号，要等回踩订单区块或缺口并收盘守住';
  const tail = extra.length ? '。' + extra.join('，') : '';
  if (lastRecent && lastEv.kind === 'CHoCH') {
    return { vote: lastEv.dir, why: '近端 CHoCH ' + (lastEv.dir > 0 ? '转多' : '转空') + '（' + age + ' 根前）。' + wait + tail, core: true };
  }
  if (lastRecent && lastEv.kind === 'BOS') {
    return { vote: lastEv.dir, why: '近端 BOS ' + (lastEv.dir > 0 ? '延续偏多' : '延续偏空') + '（' + age + ' 根前）。' + wait + tail, core: true };
  }
  if (inOb) {
    return { vote: inOb.dir, why: extra.join('，') + '。近端突破已过期，只按区块方向计票', core: true };
  }
  if (inFvg) {
    return { vote: 0, why: extra.join('，') + '。缺口本身不够当方向票，只作位置说明', core: true };
  }
  if (lastEv) {
    return { vote: 0, why: lastEv.kind + ' ' + (lastEv.dir > 0 ? '偏多' : '偏空') + '已过去 ' + age + ' 根，不再作为方向票', core: true };
  }
  return { vote: 0, why: smc.label || '结构未定', core: true };
}

export function mtfVote(mtf, klines) {
  const ladder = mtfLadder(state.tf);
  if (!ladder.length) return { vote: 0, why: '当前已是最大周期，没有更大周期对照', core: true };
  const names = [];
  const votes = [];
  ladder.forEach((x) => {
    const src = x.id === state.tf ? klines : (mtf && mtf[x.id]);
    const b = mtfBias(src);
    votes.push(b.vote);
    names.push(x.name + (b.vote > 0 ? '偏多' : b.vote < 0 ? '偏空' : (b.label === '样本不足' ? '样本不足' : '纠缠')));
  });
  const sum = votes.reduce((s, v) => s + v, 0);
  const hasDown = votes.some((v) => v < 0);
  const hasUp = votes.some((v) => v > 0);
  const need = ladder.length >= 3 ? 2 : ladder.length;
  if (sum >= need && !hasDown) return { vote: 1, why: names.join(' / '), core: true };
  if (sum <= -need && !hasUp) return { vote: -1, why: names.join(' / '), core: true };
  return { vote: 0, why: '大周期没有同向：' + names.join(' / '), core: true };
}

export function dayVote(ticker, last) {
  if (!ticker || ticker.high == null || ticker.low == null || ticker.high <= ticker.low) return null;
  const pos = (last - ticker.low) / (ticker.high - ticker.low);
  const day = mkt().hasSession ? '今日' : '24小时';
  let why = '位于' + day + '区间中部';
  if (pos >= 0.85) why = '靠近' + day + '高点，延续需要回踩确认，不加方向票';
  else if (pos <= 0.15) why = '靠近' + day + '低点，下破需要结构确认，不加方向票';
  else if (pos >= 0.6) why = '位于' + day + '区间偏上，位置本身不加方向票';
  else if (pos <= 0.4) why = '位于' + day + '区间偏下，位置本身不加方向票';
  return { vote: 0, why: why, pos: pos };
}
