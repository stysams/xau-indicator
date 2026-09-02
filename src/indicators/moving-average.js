import { ema, sma } from '../core/math.js';
import { tfSpanMs } from '../core/bars.js';

export const AVERAGE_KINDS = ['ma', 'ema'];
export const AVERAGE_PERIODS = [5, 9, 10, 12, 20, 21, 30, 50, 100, 200];
export const AVERAGE_TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];

export function averageLineId(line) {
  return line.kind + '-' + line.tf + '-' + line.period;
}

export function averageTfLabel(tf) {
  if (tf === '1d') return '1日';
  return tf;
}

export function averageLineLabel(line) {
  return averageTfLabel(line.tf) + ' ' + line.kind.toUpperCase() + line.period;
}

export function normalizeAverageLines(raw) {
  const seen = {};
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((line) => {
    const kind = line && String(line.kind || '').toLowerCase();
    const period = Number(line && line.period);
    const tf = line && String(line.tf || '').toLowerCase();
    if (AVERAGE_KINDS.indexOf(kind) < 0 || AVERAGE_PERIODS.indexOf(period) < 0 || AVERAGE_TFS.indexOf(tf) < 0) return;
    const next = { kind: kind, period: period, tf: tf };
    const id = averageLineId(next);
    if (seen[id]) return;
    seen[id] = true;
    out.push(next);
  });
  return out.sort((a, b) => {
    const tfDiff = AVERAGE_TFS.indexOf(a.tf) - AVERAGE_TFS.indexOf(b.tf);
    if (tfDiff) return tfDiff;
    const kindDiff = AVERAGE_KINDS.indexOf(a.kind) - AVERAGE_KINDS.indexOf(b.kind);
    return kindDiff || a.period - b.period;
  });
}

function mergeBars(a, b) {
  const byTime = new Map();
  (a || []).forEach((bar) => { if (bar && bar.t) byTime.set(bar.t, bar); });
  (b || []).forEach((bar) => { if (bar && bar.t) byTime.set(bar.t, bar); });
  return Array.from(byTime.values()).sort((x, y) => x.t - y.t);
}

function valuesAtChartBars(chartBars, chartTf, sourceBars, sourceTf, values) {
  const out = new Array(chartBars.length).fill(null);
  let sourceIndex = -1;
  if (sourceTf === chartTf) {
    chartBars.forEach((bar, i) => {
      while (sourceIndex + 1 < sourceBars.length && sourceBars[sourceIndex + 1].t <= bar.t) sourceIndex++;
      if (sourceIndex >= 0 && sourceBars[sourceIndex].t === bar.t) out[i] = values[sourceIndex];
    });
    return out;
  }

  const chartSpan = tfSpanMs(chartTf) / 1000;
  const sourceSpan = tfSpanMs(sourceTf) / 1000;
  chartBars.forEach((bar, i) => {
    const availableAt = bar.t + chartSpan;
    while (sourceIndex + 1 < sourceBars.length && sourceBars[sourceIndex + 1].t + sourceSpan <= availableAt) sourceIndex++;
    if (sourceIndex >= 0) out[i] = values[sourceIndex];
  });
  return out;
}

export function buildAverageSeries(chartBars, chartTf, mtf, lines) {
  return normalizeAverageLines(lines).map((line) => {
    const source = line.tf === chartTf
      ? mergeBars(mtf && mtf[line.tf], chartBars)
      : ((mtf && mtf[line.tf]) || []);
    const closes = source.map((bar) => bar.c);
    const values = line.kind === 'ema' ? ema(closes, line.period) : sma(closes, line.period);
    return Object.assign({}, line, {
      id: averageLineId(line),
      label: averageLineLabel(line),
      values: valuesAtChartBars(chartBars, chartTf, source, line.tf, values),
    });
  });
}
