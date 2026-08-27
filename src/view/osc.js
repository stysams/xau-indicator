import { n } from '../core/format.js';
import { rsi } from '../core/math.js';
import { H, PAD, W, state } from '../state.js';
import { lineD, svgEl } from './svg.js';

export const OSC_PANES = [
  { key: 'macd', height: 68, digits: 3, title: 'MACD 12/26/9' },
  { key: 'rsi', height: 62, digits: 1, title: function () { return 'RSI ' + (state.rsiN || 14); }, lo: 0, hi: 100 },
];

export function oscLayout() {
  const defs = OSC_PANES.filter((d) => !!state.ind[d.key]);
  const n = defs.length;
  const gap = n ? 8 : 0;
  const shrink = n >= 2;
  const panes = defs.map((d) => ({
    key: d.key,
    h: shrink ? 56 : d.height,
    digits: d.digits || 2,
    title: typeof d.title === 'function' ? d.title() : (d.title || d.key.toUpperCase()),
    lo: d.lo,
    hi: d.hi,
    top: 0,
  }));
  let used = 0;
  panes.forEach((p) => { used += gap + p.h; });
  const plotH = H - PAD.t - PAD.b - used;
  const plotBottom = PAD.t + plotH;
  let top = plotBottom;
  panes.forEach((p) => {
    top += gap;
    p.top = top;
    top += p.h;
  });
  return { plotH: plotH, plotBottom: plotBottom, panes: panes, gap: gap };
}

export function paneY(pane, v) {
  return pane.top + (pane.hi - v) / Math.max(1e-9, pane.hi - pane.lo) * pane.h;
}

export function findPane(s, key) {
  const panes = (s && s.panes) || [];
  for (let i = 0; i < panes.length; i++) if (panes[i].key === key) return panes[i];
  return null;
}

export function drawOscSeparator(svg, pane) {
  svg.appendChild(svgEl('line', {
    x1: PAD.l, x2: W - PAD.r, y1: pane.top - 4, y2: pane.top - 4,
    stroke: 'var(--border)', 'stroke-width': '1',
  }));
}

export function drawMacdPane(svg, view, pane, x, nBars, bodyW) {
  let macdLo = 0, macdHi = 0;
  view.macdHist.concat(view.macdDif, view.macdDea).forEach((v) => {
    if (v != null) { macdLo = Math.min(macdLo, v); macdHi = Math.max(macdHi, v); }
  });
  if (macdHi === macdLo) { macdHi += 1; macdLo -= 1; }
  const padM = (macdHi - macdLo) * 0.12 || 0.01;
  pane.lo = macdLo - padM;
  pane.hi = macdHi + padM;
  const yM = (v) => paneY(pane, v);
  drawOscSeparator(svg, pane);
  svg.appendChild(svgEl('line', {
    x1: PAD.l, x2: W - PAD.r, y1: yM(0), y2: yM(0),
    stroke: 'rgba(15,35,34,.16)', 'stroke-width': '1',
  }));
  const gH = svgEl('g', {});
  view.macdHist.forEach((v, i) => {
    if (v == null) return;
    const xc = x(i);
    const y1 = yM(v), y0 = yM(0);
    const rect = svgEl('rect', {
      x: xc - bodyW / 2,
      y: Math.min(y0, y1),
      width: bodyW,
      height: Math.max(1.2, Math.abs(y1 - y0)),
      fill: v >= 0 ? 'var(--up)' : 'var(--down)',
      opacity: '.72',
    });
    if (view.follow && i === nBars - 1) rect.setAttribute('id', 'ck-macd-h');
    gH.appendChild(rect);
  });
  svg.appendChild(gH);
  function polyM(arr, stroke, dash, id) {
    const d = lineD(arr, x, yM);
    if (!d) return;
    const path = svgEl('path', {
      d: d, fill: 'none', stroke: stroke, 'stroke-width': '1.3',
      'stroke-dasharray': dash || '', 'stroke-linejoin': 'round',
    });
    path.setAttribute('id', id);
    svg.appendChild(path);
  }
  polyM(view.macdDif, 'var(--accent)', '', 'ck-macd-dif');
  polyM(view.macdDea, 'var(--accent-2)', '4 3', 'ck-macd-dea');
  const lab = svgEl('text', {
    x: PAD.l + 2, y: pane.top + 11,
    fill: 'var(--ink-3)', 'font-size': '10', 'font-family': 'var(--font)',
  });
  lab.textContent = pane.title;
  svg.appendChild(lab);
  const lastH = view.macdHist[nBars - 1];
  if (lastH != null) {
    const ht = svgEl('text', {
      x: W - PAD.r + 6, y: yM(lastH) + 3,
      fill: 'var(--ink-3)', 'font-size': '10', 'font-family': 'var(--font-mono)',
    });
    ht.setAttribute('id', 'ck-macd-last');
    ht.textContent = lastH.toFixed(2);
    svg.appendChild(ht);
  }
}

export function drawRsiPane(svg, view, pane, x, nBars) {
  pane.lo = 0;
  pane.hi = 100;
  const yR = (v) => paneY(pane, v);
  drawOscSeparator(svg, pane);
  svg.appendChild(svgEl('rect', {
    x: PAD.l, y: yR(100),
    width: W - PAD.l - PAD.r,
    height: Math.max(1, yR(70) - yR(100)),
    fill: 'var(--down-soft)',
    opacity: '.7',
  }));
  svg.appendChild(svgEl('rect', {
    x: PAD.l, y: yR(30),
    width: W - PAD.l - PAD.r,
    height: Math.max(1, yR(0) - yR(30)),
    fill: 'var(--up-soft)',
    opacity: '.7',
  }));
  [30, 50, 70].forEach((g) => {
    svg.appendChild(svgEl('line', {
      x1: PAD.l, x2: W - PAD.r, y1: yR(g), y2: yR(g),
      stroke: 'rgba(15,35,34,.16)', 'stroke-width': '1',
      'stroke-dasharray': g === 50 ? '' : '3 3',
    }));
  });
  const d = lineD(view.rsi, x, yR);
  if (d) {
    const path = svgEl('path', {
      d: d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': '1.35',
      'stroke-linejoin': 'round',
    });
    path.setAttribute('id', 'ck-rsi');
    svg.appendChild(path);
  }
  const last = view.rsi[nBars - 1];
  const lab = svgEl('text', {
    x: PAD.l + 2, y: pane.top + 11,
    fill: 'var(--ink-3)', 'font-size': '10', 'font-family': 'var(--font)',
  });
  lab.setAttribute('id', 'ck-rsi-lab');
  lab.textContent = pane.title + (last == null ? '' : '  ' + last.toFixed(1));
  svg.appendChild(lab);
  if (last != null) {
    const ht = svgEl('text', {
      x: W - PAD.r + 6, y: yR(last) + 3,
      fill: last >= 70 ? 'var(--down)' : last <= 30 ? 'var(--up)' : 'var(--ink-3)',
      'font-size': '10', 'font-family': 'var(--font-mono)',
    });
    ht.setAttribute('id', 'ck-rsi-last');
    ht.textContent = last.toFixed(1);
    svg.appendChild(ht);
  }
}

export function drawOscPanes(svg, view, panes, x, nBars, bodyW) {
  panes.forEach((pane) => {
    if (pane.key === 'macd') drawMacdPane(svg, view, pane, x, nBars, bodyW);
    else if (pane.key === 'rsi') drawRsiPane(svg, view, pane, x, nBars);
  });
}
