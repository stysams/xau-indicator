import { px } from '../core/format.js';
import { PAD, W, state } from '../state.js';
import { svgEl } from './svg.js';

export function drawUsidxPane(svg, view, pane, x, nBars, bodyW) {
  if (!pane) return;
  const bars = state.usidxBars || [];
  const first = view.bars[0] && view.bars[0].t;
  const last = view.bars[nBars - 1] && view.bars[nBars - 1].t;
  const visible = bars.filter((b) => (first == null || b.t >= first) && (last == null || b.t <= last));
  const byTime = new Map();
  bars.forEach((b) => byTime.set(b.t, b));
  const aligned = view.bars.map((k) => byTime.get(k.t) || null);
  let lo = Infinity, hi = -Infinity;
  visible.forEach((b) => { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
  if (!Number.isFinite(lo) || hi === lo) {
    lo = 0;
    hi = 1;
  } else {
    const pad = (hi - lo) * 0.12 || 0.01;
    lo -= pad;
    hi += pad;
  }
  const y = (v) => pane.top + (hi - v) / (hi - lo) * pane.h;
  const candleW = Math.max(0.7, bodyW || 1.4);
  const wickW = candleW < 1.7
    ? Math.max(0.55, candleW * 0.9)
    : Math.min(2.1, Math.max(0.85, candleW * 0.08));
  const bodyStroke = candleW < 2.2
    ? Math.max(0.35, Math.min(0.95, candleW * 0.22))
    : Math.min(1.4, Math.max(0.7, candleW * 0.05));
  const hollowUp = candleW >= 2.2;
  svg.appendChild(svgEl('line', { x1: PAD.l, x2: W - PAD.r, y1: pane.top - 4, y2: pane.top - 4, stroke: 'var(--border)', 'stroke-width': '1' }));
  const gC = svgEl('g', {});
  aligned.forEach((b, i) => {
    if (!b) return;
    const xc = x(i);
    const up = b.c >= b.o;
    const color = up ? 'var(--up)' : 'var(--down)';
    const isLast = view.follow && i === nBars - 1;
    const wick = svgEl('line', {
      x1: xc, x2: xc, y1: y(b.h), y2: y(b.l),
      stroke: color, 'stroke-width': String(wickW),
    });
    if (isLast) wick.setAttribute('id', 'ck-usidx-wick');
    gC.appendChild(wick);
    const top = y(Math.max(b.o, b.c));
    const bot = y(Math.min(b.o, b.c));
    const body = svgEl('rect', {
      x: xc - candleW / 2, y: top, width: candleW,
      height: Math.max(Math.min(1.2, candleW), bot - top),
      fill: (up && hollowUp) ? 'var(--bg)' : color,
      stroke: color, 'stroke-width': String(bodyStroke),
    });
    if (isLast) body.setAttribute('id', 'ck-usidx-body');
    gC.appendChild(body);
  });
  svg.appendChild(gC);
  const title = svgEl('text', { x: PAD.l + 2, y: pane.top + 11, fill: 'var(--ink-3)', 'font-size': '10', 'font-family': 'var(--font)' });
  title.setAttribute('id', 'ck-usidx-lab');
  title.textContent = 'USIDX DXY' + (state.usidxTicker && state.usidxTicker.last != null ? '  ' + px(state.usidxTicker.last, 3) : '  等待数据');
  svg.appendChild(title);
  const value = state.usidxTicker && state.usidxTicker.last != null
    ? state.usidxTicker.last
    : (visible.length ? visible[visible.length - 1].c : null);
  if (value == null) return;
  const tag = svgEl('text', { id: 'ck-usidx-last', x: W - PAD.r + 6, y: y(value) + 3, fill: 'var(--accent-2)', 'font-size': '10', 'font-family': 'var(--font-mono)' });
  tag.textContent = value.toFixed(3);
  svg.appendChild(tag);
}
