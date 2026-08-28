import { px } from '../core/format.js';
import { PAD, W, state } from '../state.js';
import { lineD, svgEl } from './svg.js';

export function drawUsidxPane(svg, view, pane, x, nBars) {
  if (!pane) return;
  const bars = state.usidxBars || [];
  const first = view.bars[0] && view.bars[0].t;
  const last = view.bars[nBars - 1] && view.bars[nBars - 1].t;
  const visible = bars.filter((b) => (first == null || b.t >= first) && (last == null || b.t <= last));
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
  const values = view.bars.map((k) => {
    let best = null;
    for (let i = 0; i < bars.length; i++) {
      if (bars[i].t <= k.t) best = bars[i]; else break;
    }
    return best ? best.c : null;
  });
  svg.appendChild(svgEl('line', { x1: PAD.l, x2: W - PAD.r, y1: pane.top - 4, y2: pane.top - 4, stroke: 'var(--border)', 'stroke-width': '1' }));
  const d = lineD(values, x, y);
  if (d) svg.appendChild(svgEl('path', { id: 'ck-usidx', d: d, fill: 'none', stroke: 'var(--accent-2)', 'stroke-width': '1.35', 'stroke-linejoin': 'round' }));
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
