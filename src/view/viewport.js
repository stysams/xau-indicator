import { n } from '../core/format.js';
import { bandArr, bollCore, macdOf, rsiSeries, vwapSeries } from '../core/math.js';
import { buildAverageSeries } from '../indicators/moving-average.js';
import { barsForChart, isLiveFollow, liveEndFor } from '../net/rest.js';
import { $, LIVE_ANCHOR, MAX_VIEW_SLOTS, MIN_BARS, state } from '../state.js';

export const CHART_MAGNIFY_MIN = 0.7;
export const CHART_MAGNIFY_MAX = 1.6;
export const CHART_MAGNIFY_STEP = 0.1;

export function normalizeChartMagnify(value) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 1;
  return Math.round(Math.min(CHART_MAGNIFY_MAX, Math.max(CHART_MAGNIFY_MIN, safe)) * 10) / 10;
}

export function priceOffsetForDrag(startOffset, deltaY, plotHeight, priceSpan) {
  const base = Number.isFinite(Number(startOffset)) ? Number(startOffset) : 0;
  const dy = Number(deltaY);
  const height = Number(plotHeight);
  const span = Number(priceSpan);
  if (!Number.isFinite(dy) || !Number.isFinite(height) || height <= 0 || !Number.isFinite(span) || span <= 0) return base;
  return base + dy / height * span;
}

export function candleBodyWidth(slotWidth) {
  const slot = Math.max(0, Number(slotWidth) || 0);
  return Math.max(0.7, Math.min(14, slot * 0.58, Math.max(0.4, slot - 0.5)));
}

export function maxViewCount(n) {
  const loaded = Math.max(1, n || 1);
  const fitAll = Math.ceil(loaded / Math.max(0.28, LIVE_ANCHOR));
  return Math.max(loaded, Math.min(fitAll, MAX_VIEW_SLOTS, loaded * 3));
}

export function chartXScale(view, left, right) {
  const start = Number(view && view.start) || 0;
  const count = Math.max(1, Number(view && view.count) || 1);
  const dataStart = Math.max(0, start);
  const slotW = (right - left) / count;
  const atSlot = (slotIndex) => left + (slotIndex + 0.5) * slotW;
  return {
    slotW: slotW,
    local: (localIndex) => atSlot(localIndex + dataStart - start),
    index: (barIndex) => atSlot(barIndex - start),
    clampedIndex: (barIndex) => {
      const slotIndex = barIndex - start;
      if (slotIndex < 0) return left;
      if (slotIndex >= count) return right;
      return atSlot(slotIndex);
    },
  };
}

export function priceLevelsInRange(levels, lo, hi) {
  if (!Array.isArray(levels) || !Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  const lower = Math.min(lo, hi);
  const upper = Math.max(lo, hi);
  return levels.filter((level) => {
    const price = level && Number(level.price);
    return Number.isFinite(price) && price >= lower && price <= upper;
  });
}

export function resetZoom() {
  state.viewCount = null;
  state.viewEnd = null;
  state.followLive = true;
  state.priceOffset = 0;
  state.chartScale = null;
}

export function chartSlice(klines) {
  const n = klines.length;
  if (!n) {
    return { start: 0, end: 0, count: 0, n: 0, bars: [], averageSeries: [], rsi: [], follow: true };
  }
  let count = state.viewCount == null ? n : state.viewCount;
  count = Math.min(maxViewCount(n), Math.max(MIN_BARS, Math.round(count)));
  let end = (state.followLive || state.viewEnd == null) ? liveEndFor(n, count) : state.viewEnd;
  const maxEnd = n + count - 1;
  end = Math.min(maxEnd, Math.max(1, Math.round(end)));
  const start = end - count;
  const i0 = Math.max(0, start);
  const i1 = Math.min(n, end);
  const closes = klines.map((k) => k.c);
  const averageSeries = buildAverageSeries(klines, state.tf, state.mtf, state.averageLines)
    .filter((line) => !state.averageVisibility || state.averageVisibility[line.kind] !== false)
    .map((line) => Object.assign({}, line, { values: line.values.slice(i0, i1) }));
  const period = state.bollN || 20;
  const kMul = state.bollK || 2;
  const core = bollCore(closes, period);
  const b1 = bandArr(core.mid, core.sd, 1);
  const bk = bandArr(core.mid, core.sd, kMul);
  const b3 = bandArr(core.mid, core.sd, 3);
  const bw = core.mid.map((m, i) => (m && core.sd[i] != null) ? (2 * kMul * core.sd[i]) / m : null);
  const pb = closes.map((c, i) => {
    const u = bk.up[i], d = bk.dn[i];
    if (u == null || d == null || u === d) return null;
    return (c - d) / (u - d);
  });
  const md = macdOf(closes);
  const rs = rsiSeries(closes, state.rsiN || 14);
  const vw = vwapSeries(klines);
  return {
    start: start,
    end: end,
    count: count,
    n: n,
    bars: klines.slice(i0, i1),
    averageSeries: averageSeries,
    bollMid: core.mid.slice(i0, i1),
    bollUp: bk.up.slice(i0, i1),
    bollDn: bk.dn.slice(i0, i1),
    boll1Up: b1.up.slice(i0, i1),
    boll1Dn: b1.dn.slice(i0, i1),
    boll3Up: b3.up.slice(i0, i1),
    boll3Dn: b3.dn.slice(i0, i1),
    bw: bw.slice(i0, i1),
    pb: pb.slice(i0, i1),
    macdDif: md.dif.slice(i0, i1),
    macdDea: md.dea.slice(i0, i1),
    macdHist: md.hist.slice(i0, i1),
    rsi: rs.slice(i0, i1),
    vwap: vw.slice(i0, i1),
    follow: state.followLive || end >= n,
  };
}

export function updateZoomLabel() {
  const lab = $('zoomLab');
  const btn = $('btnZoomReset');
  if (!lab || !btn) return;
  const view = chartSlice(barsForChart());
  if (state.followLive) {
    lab.textContent = '盯盘 ' + view.bars.length + ' / ' + view.n;
  } else {
    lab.textContent = '可见 ' + view.bars.length + ' / ' + view.n;
  }
  btn.disabled = !!(state.followLive && state.viewCount == null && !(Number(state.priceOffset) || 0));
}

export function applyView(count, end, n) {
  const nextCount = Math.min(maxViewCount(n), Math.max(MIN_BARS, Math.round(count)));
  const maxEnd = n + nextCount - 1;
  const nextEnd = Math.min(maxEnd, Math.max(1, Math.round(end)));
  state.viewCount = nextCount;
  state.viewEnd = nextEnd;
  state.followLive = isLiveFollow(nextEnd, n, nextCount);
  state.chartScale = null;
}
