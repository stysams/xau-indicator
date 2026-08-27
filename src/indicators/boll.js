import { n } from '../core/format.js';
import { bollCore, bwRankWindow, macdOf, percentileRank } from '../core/math.js';
import { state } from '../state.js';

export function analyzeBoll(klines) {
  const period = state.bollN || 20;
  const kMul = state.bollK || 2;
  if (!klines || klines.length < period + 2) return { ok: false, period: period, kMul: kMul };
  const n = klines.length;
  const closes = klines.map((x) => x.c);
  const core = bollCore(closes, period);
  const upK = [], dnK = [], bw = [], pb = [];
  for (let i = 0; i < n; i++) {
    if (core.mid[i] == null) {
      upK.push(null); dnK.push(null); bw.push(null); pb.push(null);
      continue;
    }
    const u = core.mid[i] + kMul * core.sd[i];
    const d = core.mid[i] - kMul * core.sd[i];
    upK.push(u);
    dnK.push(d);
    bw.push(core.mid[i] ? (2 * kMul * core.sd[i]) / core.mid[i] : null);
    pb.push(u === d ? null : (closes[i] - d) / (u - d));
  }
  const last = n - 1;
  const i8 = Math.max(period - 1, last - 8);
  const uSlope = (upK[last] != null && upK[i8] != null) ? upK[last] - upK[i8] : 0;
  const dSlope = (dnK[last] != null && dnK[i8] != null) ? dnK[last] - dnK[i8] : 0;
  let shape = '走平';
  if (uSlope > 0 && dSlope < 0) shape = '开口';
  else if (uSlope < 0 && dSlope > 0) shape = '收口';
  const bwWinN = bwRankWindow(state.tf);
  const bwWin = bw.slice(Math.max(0, last - (bwWinN - 1)), last + 1);
  const bwValid = bwWin.filter((v) => v != null).length;
  const bwRank = bwValid >= Math.min(bwWinN, 30) ? percentileRank(bwWin, bw[last]) : null;
  let bwLabel = '带宽位于近端中位';
  if (bwRank != null && bwRank <= 0.2) bwLabel = '带宽收窄，近端挤压';
  else if (bwRank != null && bwRank >= 0.8) bwLabel = '带宽偏宽，波动放大';
  const expandingFromSqueeze = bw[i8] != null && bw[last] != null && bw[last] > bw[i8] && (
    (bwRank != null && bwRank <= 0.4) || shape === '开口'
  );
  let brokeUp = false, brokeDn = false, touchUp = false, touchDn = false;
  let brokeUpI = -1, brokeDnI = -1;
  for (let i = Math.max(period - 1, last - 8); i <= last; i++) {
    if (upK[i] == null) continue;
    if (klines[i].c > upK[i]) { brokeUp = true; brokeUpI = i; }
    if (klines[i].c < dnK[i]) { brokeDn = true; brokeDnI = i; }
    if (klines[i].h >= upK[i] && klines[i].c <= upK[i]) touchUp = true;
    if (klines[i].l <= dnK[i] && klines[i].c >= dnK[i]) touchDn = true;
  }
  const lastPb = pb[last];
  const inside = lastPb != null && lastPb >= 0 && lastPb <= 1;
  let touchKind = '运行在主轨内';
  let reclaimUp = false, reclaimDn = false;
  if (brokeUp && inside) { touchKind = '刺破上轨后收回'; reclaimUp = true; }
  else if (brokeDn && inside) { touchKind = '刺破下轨后收回'; reclaimDn = true; }
  else if (lastPb != null && lastPb > 1) touchKind = '收盘在上轨外';
  else if (lastPb != null && lastPb < 0) touchKind = '收盘在下轨外';
  else if (lastPb != null && lastPb >= 0.85) touchKind = '贴近上轨';
  else if (lastPb != null && lastPb <= 0.15) touchKind = '贴近下轨';
  else if (touchUp) touchKind = '近端触上轨';
  else if (touchDn) touchKind = '近端触下轨';
  return {
    ok: true, period: period, kMul: kMul,
    lastPb: lastPb, lastBw: bw[last], bwRank: bwRank, bw: bw, pb: pb,
    shape: shape, bwLabel: bwLabel, touchKind: touchKind,
    reclaimUp: reclaimUp, reclaimDn: reclaimDn,
    expandingFromSqueeze: expandingFromSqueeze,
    brokeUpI: brokeUpI, brokeDnI: brokeDnI,
  };
}

export function macdEvents(dif, dea, hist) {
  const n = dif.length;
  let golden = -1, death = -1;
  for (let i = 1; i < n; i++) {
    if (dif[i] == null || dea[i] == null) continue;
    const prev = dif[i - 1] - dea[i - 1];
    const cur = dif[i] - dea[i];
    // hist 符号与 DIF-DEA 同步，金叉/死叉已覆盖「红柱转正/绿柱转负」
    if (prev <= 0 && cur > 0) golden = i;
    if (prev >= 0 && cur < 0) death = i;
  }
  return {
    golden: golden, death: death, histUp: golden, histDn: death,
    lastDif: dif[n - 1], lastDea: dea[n - 1], lastHist: hist[n - 1],
  };
}

export function bollMacdSignal(klines) {
  const none = { vote: 0, label: '样本不足', why: '布林或 MACD 样本不够，复合信号暂不判定', marks: [] };
  const b = analyzeBoll(klines);
  if (!b.ok) return none;
  const m = macdOf(klines.map((k) => k.c));
  if (m.hist.length < 30 || m.hist[m.hist.length - 1] == null) return none;
  const ev = macdEvents(m.dif, m.dea, m.hist);
  const n = klines.length;
  const recent = (i) => i >= 0 && (n - 1 - i) <= 5;
  const hist = ev.lastHist;
  const histPrev = m.hist[n - 2];
  const histGrowPos = hist > 0 && histPrev != null && hist > histPrev;
  const histGrowNeg = hist < 0 && histPrev != null && hist < histPrev;
  const pb = b.lastPb;
  const marks = [];
  function hit(vote, label, why, i) {
    if (i >= 0) marks.push({ i: i, vote: vote, label: label });
    return { vote: vote, label: label, why: why, marks: marks, pb: pb, hist: hist, dif: ev.lastDif, dea: ev.lastDea };
  }
  if (b.reclaimDn && recent(ev.golden)) {
    return hit(1, '下轨收回 + 转多',
      '近端刺破下轨后收回带内，同时 MACD 金叉（红柱同步转正）。只描述结构对齐，不是下单指令。',
      Math.max(ev.golden, b.brokeDnI));
  }
  if (b.reclaimUp && recent(ev.death)) {
    return hit(-1, '上轨收回 + 转空',
      '近端刺破上轨后收回带内，同时 MACD 死叉（绿柱同步转负）。只描述结构对齐，不是下单指令。',
      Math.max(ev.death, b.brokeUpI));
  }
  if (b.expandingFromSqueeze && b.shape === '开口' && pb != null && pb >= 0.5 && hist > 0 && histGrowPos) {
    return hit(1, '开口向上 + 红柱',
      '带宽从挤压转为开口，价格在中轨上方，MACD 红柱放大。', n - 1);
  }
  if (b.expandingFromSqueeze && b.shape === '开口' && pb != null && pb <= 0.5 && hist < 0 && histGrowNeg) {
    return hit(-1, '开口向下 + 绿柱',
      '带宽从挤压转为开口，价格在中轨下方，MACD 绿柱放大。', n - 1);
  }
  if (pb != null && pb > 1 && recent(ev.death)) {
    return hit(-1, '上轨外 + 死叉',
      '收盘还在上轨外，但 MACD 已经死叉，价格延伸可能快于动能。', ev.death);
  }
  if (pb != null && pb < 0 && recent(ev.golden)) {
    return hit(1, '下轨外 + 金叉',
      '收盘还在下轨外，但 MACD 已经金叉，动能可能开始回头。', ev.golden);
  }
  if (pb != null && pb >= 0.85 && histGrowPos) {
    return hit(1, '贴上轨 + 红柱放大',
      '价格贴近或刺破上轨，MACD 红柱仍在放大。偏多动能，也已经靠近带沿。', n - 1);
  }
  if (pb != null && pb <= 0.15 && histGrowNeg) {
    return hit(-1, '贴下轨 + 绿柱放大',
      '价格贴近或刺破下轨，MACD 绿柱仍在放大。偏空动能，也已经靠近带沿。', n - 1);
  }
  if (pb != null && pb >= 0.4 && pb <= 0.6 && recent(ev.golden)) {
    return hit(1, '中轨附近 + 金叉', '价格回到中轨附近，MACD 金叉。', ev.golden);
  }
  if (pb != null && pb >= 0.4 && pb <= 0.6 && recent(ev.death)) {
    return hit(-1, '中轨附近 + 死叉', '价格回到中轨附近，MACD 死叉。', ev.death);
  }
  let macdLab = 'DIF 与 DEA 纠缠';
  if (ev.lastDif > ev.lastDea && hist > 0) macdLab = 'MACD 红柱，DIF 在上';
  else if (ev.lastDif < ev.lastDea && hist < 0) macdLab = 'MACD 绿柱，DIF 在下';
  return {
    vote: 0, label: '未对齐',
    why: b.touchKind + '；' + b.shape + '；' + macdLab + '。布林与 MACD 没有同时满足复合条件。',
    marks: marks, pb: pb, hist: hist, dif: ev.lastDif, dea: ev.lastDea,
  };
}

export function getBollMacd(klines) {
  const last = klines[klines.length - 1];
  const key = [
    klines.length,
    last && last.t,
    last && last.o,
    last && last.h,
    last && last.l,
    last && last.c,
    state.bollN,
    state.bollK,
    state.tf,
  ].join(':');
  if (state._bmKey === key && state._bm) return state._bm;
  const pack = {
    boll: analyzeBoll(klines),
    sig: bollMacdSignal(klines),
  };
  state._bmKey = key;
  state._bm = pack;
  return pack;
}
