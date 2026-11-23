import { px } from '../core/format.js';
import { guideHeader, guideLine } from '../indicators/div3.js';
import { fibNear, fibRatioText } from '../indicators/fib.js';
import { patSrTitle } from '../indicators/pattern-sr.js';
import { PAD } from '../state.js';
import { svgEl } from './svg.js';

// 按水平视窗 [xMin, xMax] 对真实 K 线坐标线段做线性裁剪，
// 避免左/右锚点移出视窗时被钳死在边界，导致斜线/折线随缩放平移漂移。
export function clipSegmentX(x1, y1, x2, y2, xMin, xMax) {
  if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return null;
  let ax = x1, ay = y1, bx = x2, by = y2;
  if (ax > bx) {
    const tx = ax, ty = ay;
    ax = bx; ay = by;
    bx = tx; by = ty;
  }
  if (bx < xMin || ax > xMax) return null;
  const dx = bx - ax;
  if (dx === 0) return { x1: ax, y1: ay, x2: bx, y2: by };
  if (ax < xMin) {
    const t = (xMin - ax) / dx;
    ay = ay + (by - ay) * t;
    ax = xMin;
  }
  if (bx > xMax) {
    const t = (xMax - ax) / (bx - ax);
    by = ay + (by - ay) * t;
    bx = xMax;
  }
  return { x1: ax, y1: ay, x2: bx, y2: by };
}

function indexBoundsForX(xIndex, xMin, xMax) {
  const x0 = xIndex(0);
  const slotW = xIndex(1) - x0;
  if (!Number.isFinite(slotW) || Math.abs(slotW) < 1e-9) return null;
  return {
    slotW: slotW,
    iLeft: (xMin - x0) / slotW,
    iRight: (xMax - x0) / slotW,
  };
}

export function drawPbSetup(svg, pack, xIndex, y, xRight) {
  if (!pack || pack.hide || pack.status === 'none' || !pack.points || !pack.points.length) return;
  const rightBound = xRight != null ? xRight : (960 - PAD.r);
  const color = pack.dir > 0 ? 'var(--up)' : 'var(--down)';
  const op = pack.status === 'trigger' ? '.95' : (pack.status === 'watch' ? '.82' : '.42');
  const dash = pack.status === 'trigger' ? '' : '5 4';
  let d = '';
  for (let i = 0; i < pack.points.length - 1; i++) {
    const pA = pack.points[i];
    const pB = pack.points[i + 1];
    const seg = clipSegmentX(xIndex(pA.i), y(pA.price), xIndex(pB.i), y(pB.price), PAD.l, rightBound);
    if (!seg) continue;
    d += 'M' + seg.x1.toFixed(1) + ',' + seg.y1.toFixed(1) + 'L' + seg.x2.toFixed(1) + ',' + seg.y2.toFixed(1);
  }
  if (d) {
    svg.appendChild(svgEl('path', {
      d: d, fill: 'none', stroke: color,
      'stroke-width': pack.status === 'trigger' ? '1.8' : '1.4',
      'stroke-dasharray': dash, 'stroke-linejoin': 'round', opacity: op,
    }));
  }
  pack.points.forEach((pt) => {
    const pxX = xIndex(pt.i);
    if (pxX < PAD.l - 1 || pxX > rightBound + 1) return;
    svg.appendChild(svgEl('circle', {
      cx: pxX.toFixed(1), cy: y(pt.price).toFixed(1),
      r: '3.1', fill: color, opacity: op,
    }));
    const lowish = pt.lab === '低点' || pt.lab === '回踩' || pt.lab === '等待' || pt.lab === '杀起'
      || pt.lab === '诱空' || (pack.kind === 'trap' && pack.dir > 0 && pt.lab === '位');
    const t = svgEl('text', {
      x: pxX.toFixed(1),
      y: (y(pt.price) + (lowish ? 12 : -6)).toFixed(1),
      fill: color,
      'font-size': '10',
      'font-weight': '700',
      'font-family': 'var(--font)',
      'text-anchor': 'middle',
      stroke: 'var(--bg)',
      'stroke-width': '3',
      'paint-order': 'stroke',
      opacity: op,
    });
    t.textContent = pt.lab;
    svg.appendChild(t);
  });
  if (pack.status === 'trigger' && pack.target != null) {
    const rawX1 = xIndex(pack.recI >= 0 ? pack.recI : pack.extI);
    const lastPt = pack.points[pack.points.length - 1];
    const rawX2 = Math.max(rawX1 + 28, xIndex(lastPt.i));
    const seg = clipSegmentX(rawX1, y(pack.target), rawX2, y(pack.target), PAD.l, rightBound);
    if (seg) {
      svg.appendChild(svgEl('line', {
        x1: seg.x1.toFixed(1), x2: seg.x2.toFixed(1),
        y1: seg.y1.toFixed(1), y2: seg.y2.toFixed(1),
        stroke: color, 'stroke-width': '1', 'stroke-dasharray': '2 3', opacity: '.7',
      }));
      const tg = svgEl('text', {
        x: (seg.x2 - 4).toFixed(1),
        y: (seg.y2 - 4).toFixed(1),
        fill: color,
        'font-size': '10',
        'font-weight': '650',
        'font-family': 'var(--font)',
        'text-anchor': 'end',
        stroke: 'var(--bg)',
        'stroke-width': '3',
        'paint-order': 'stroke',
        opacity: '.8',
      });
      tg.textContent = pack.kind === 'pull' ? (pack.dir > 0 ? '前高' : '前低') : '半程';
      svg.appendChild(tg);
    }
  }
}

export function drawTrapSetup(svg, pack, xIndex, y, xRight) {
  if (!pack || pack.hide || pack.status === 'none' || pack.level == null) return;
  const rightBound = xRight != null ? xRight : (960 - PAD.r);
  const color = pack.dir > 0 ? 'var(--up)' : 'var(--down)';
  const op = pack.status === 'trigger' ? '.95' : (pack.status === 'watch' ? '.82' : '.42');
  const dash = pack.status === 'trigger' ? '' : '5 4';
  const rawX1 = xIndex(pack.firstI >= 0 ? pack.firstI : pack.srcI);
  const rawX2 = xRight != null ? xRight : xIndex((pack.points[pack.points.length - 1] || {}).i || pack.sweepI);
  const seg = clipSegmentX(rawX1, y(pack.level), rawX2, y(pack.level), PAD.l, rightBound);
  if (seg) {
    if (pack.equal && pack.radius) {
      const top = y(pack.level + pack.radius);
      const bot = y(pack.level - pack.radius);
      svg.appendChild(svgEl('rect', {
        x: Math.min(seg.x1, seg.x2).toFixed(1),
        y: Math.min(top, bot).toFixed(1),
        width: Math.max(2, Math.abs(seg.x2 - seg.x1)).toFixed(1),
        height: Math.max(1.5, Math.abs(bot - top)).toFixed(1),
        fill: color,
        opacity: '.08',
      }));
    }
    svg.appendChild(svgEl('line', {
      x1: seg.x1.toFixed(1), x2: seg.x2.toFixed(1),
      y1: seg.y1.toFixed(1), y2: seg.y2.toFixed(1),
      stroke: color, 'stroke-width': pack.status === 'trigger' ? '1.5' : '1.2',
      'stroke-dasharray': dash, opacity: op,
    }));
  }
  drawPbSetup(svg, pack, xIndex, y, rightBound);
}

export function drawHold(svg, pack, vx, y, xRight, bodyW) {
  if (!pack || !pack.ok || !pack.marks || !pack.marks.length) return;
  const half = Math.max(3.2, (bodyW || 6) * 0.55);
  pack.marks.forEach((mk) => {
    const color = mk.dir > 0 ? 'var(--up)' : 'var(--down)';
    const op = mk.status === 'trigger' ? '.95' : (mk.status === 'watch' ? '.78' : '.42');
    const dash = mk.status === 'trigger' ? '' : '5 4';
    const xc = vx(mk.i);
    const yy = y(mk.price);
    const tapY = y(mk.tap);
    const x1 = vx(Math.max(0, mk.i - 4));
    const x2 = xRight != null ? xRight : vx(mk.i + 2);
    const bandTop = Math.min(yy, tapY);
    const bandBot = Math.max(yy, tapY);
    svg.appendChild(svgEl('rect', {
      x: (xc - half).toFixed(1),
      y: bandTop.toFixed(1),
      width: (half * 2).toFixed(1),
      height: Math.max(2, bandBot - bandTop).toFixed(1),
      fill: color,
      opacity: mk.status === 'trigger' ? '.18' : '.10',
    }));
    svg.appendChild(svgEl('line', {
      x1: x1.toFixed(1), x2: x2.toFixed(1),
      y1: yy.toFixed(1), y2: yy.toFixed(1),
      stroke: color, 'stroke-width': mk.status === 'trigger' ? '1.55' : '1.2',
      'stroke-dasharray': dash, opacity: op,
    }));
    const cupW = Math.max(5.5, half + 1.2);
    const cupH = 7;
    const cupY = mk.dir > 0 ? (Math.max(yy, tapY) + 1.5) : (Math.min(yy, tapY) - 1.5);
    const d = mk.dir > 0
      ? ('M' + (xc - cupW).toFixed(1) + ',' + cupY.toFixed(1) +
        ' L' + (xc - cupW).toFixed(1) + ',' + (cupY + cupH).toFixed(1) +
        ' L' + (xc + cupW).toFixed(1) + ',' + (cupY + cupH).toFixed(1) +
        ' L' + (xc + cupW).toFixed(1) + ',' + cupY.toFixed(1))
      : ('M' + (xc - cupW).toFixed(1) + ',' + cupY.toFixed(1) +
        ' L' + (xc - cupW).toFixed(1) + ',' + (cupY - cupH).toFixed(1) +
        ' L' + (xc + cupW).toFixed(1) + ',' + (cupY - cupH).toFixed(1) +
        ' L' + (xc + cupW).toFixed(1) + ',' + cupY.toFixed(1));
    const gMk = svgEl('g', {});
    const tip = svgEl('title', {});
    tip.textContent = mk.why || mk.lab;
    gMk.appendChild(tip);
    gMk.appendChild(svgEl('path', {
      d: d, fill: 'none', stroke: color,
      'stroke-width': mk.status === 'trigger' ? '1.7' : '1.35',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-dasharray': dash, opacity: op,
    }));
    const lab = svgEl('text', {
      x: xc.toFixed(1),
      y: (mk.dir > 0 ? cupY + cupH + 11 : cupY - cupH - 4).toFixed(1),
      fill: color,
      'font-size': '10.5',
      'font-weight': '750',
      'font-family': 'var(--font)',
      'text-anchor': 'middle',
      stroke: 'var(--bg)',
      'stroke-width': '3',
      'paint-order': 'stroke',
      opacity: op,
    });
    lab.textContent = mk.lab;
    gMk.appendChild(lab);
    svg.appendChild(gMk);
  });
}

export function drawBox(svg, pack, xIndex, y, xRight) {
  if (!pack || !pack.ok || pack.top == null || pack.bottom == null) return;
  const broke = pack.status === 'breakUp' || pack.status === 'breakDn';
  const color = pack.status === 'breakUp'
    ? 'var(--up)'
    : (pack.status === 'breakDn' ? 'var(--down)' : 'var(--accent)');
  const rawX1 = xIndex(pack.boxStart >= 0 ? pack.boxStart : 0);
  if (rawX1 > xRight) return;
  const x1 = Math.max(PAD.l, rawX1);
  const x2 = xRight;
  const left = Math.min(x1, x2);
  const width = Math.max(2, Math.abs(x2 - x1));
  const yTop = y(pack.top);
  const yBot = y(pack.bottom);
  const g = svgEl('g', {});
  const tip = svgEl('title', {});
  tip.textContent = pack.why || pack.label;
  g.appendChild(tip);
  g.appendChild(svgEl('rect', {
    x: left.toFixed(1),
    y: Math.min(yTop, yBot).toFixed(1),
    width: width.toFixed(1),
    height: Math.max(1.5, Math.abs(yBot - yTop)).toFixed(1),
    fill: color,
    opacity: broke ? '.05' : '.09',
  }));
  const dash = broke ? '5 4' : '';
  const op = broke ? '.5' : '.85';
  [pack.top, pack.bottom].forEach((lv) => {
    g.appendChild(svgEl('line', {
      x1: left.toFixed(1), x2: (left + width).toFixed(1),
      y1: y(lv).toFixed(1), y2: y(lv).toFixed(1),
      stroke: color, 'stroke-width': broke ? '1.2' : '1.5',
      'stroke-dasharray': dash, opacity: op,
    }));
  });
  if (pack.mid != null) {
    g.appendChild(svgEl('line', {
      x1: left.toFixed(1), x2: (left + width).toFixed(1),
      y1: y(pack.mid).toFixed(1), y2: y(pack.mid).toFixed(1),
      stroke: color, 'stroke-width': '1',
      'stroke-dasharray': '2 5', opacity: '.42',
    }));
  }
  (pack.touches || []).forEach((tc) => {
    if (tc.i == null || tc.price == null) return;
    const xc = xIndex(tc.i);
    if (xc < left - 1 || xc > left + width + 1) return;
    g.appendChild(svgEl('circle', {
      cx: xc.toFixed(1),
      cy: y(tc.price).toFixed(1),
      r: '2.2', fill: color, opacity: broke ? '.4' : '.62',
    }));
  });
  const ext = pack.extension;
  if (ext) {
    const extColor = ext.dir > 0 ? 'var(--up)' : 'var(--down)';
    const extOpacity = broke ? '.28' : '.5';
    const extGroup = svgEl('g', { opacity: extOpacity });
    const extTitle = svgEl('title', {});
    extTitle.textContent = (ext.dir > 0 ? '向上' : '向下') + '斜向通道参考，' + ext.anchorCount + '组摆动锚点；不构成开单信号';
    extGroup.appendChild(extTitle);
    const bounds = indexBoundsForX(xIndex, PAD.l, xRight);
    const project = (line) => {
      if (!bounds) return null;
      const i1 = Math.max(line.fromI, bounds.iLeft);
      const i2 = bounds.iRight;
      if (i1 >= i2) return null;
      return {
        x1: xIndex(i1), x2: xRight,
        y1: y(line.intercept + line.slope * i1),
        y2: y(line.intercept + line.slope * i2),
      };
    };
    [ext.upper, ext.lower].forEach((line) => {
      const q = project(line);
      if (q) {
        extGroup.appendChild(svgEl('line', {
          x1: q.x1.toFixed(1), x2: q.x2.toFixed(1),
          y1: q.y1.toFixed(1), y2: q.y2.toFixed(1),
          stroke: extColor, 'stroke-width': '1.15', 'stroke-dasharray': '5 4',
        }));
      }
      (line.anchors || []).forEach((a) => {
        const ax = xIndex(a.i);
        if (ax < PAD.l - 1 || ax > xRight + 1) return;
        extGroup.appendChild(svgEl('circle', {
          cx: ax.toFixed(1), cy: y(a.price).toFixed(1), r: '2', fill: extColor,
        }));
      });
    });
    g.appendChild(extGroup);
  }
  function label(lv, txt, below) {
    const t = svgEl('text', {
      x: (left + width - 4).toFixed(1),
      y: (y(lv) + (below ? 11 : -4)).toFixed(1),
      fill: color,
      'font-size': '10.5',
      'font-weight': broke ? '650' : '750',
      'font-family': 'var(--font)',
      'text-anchor': 'end',
      stroke: 'var(--bg)',
      'stroke-width': '3',
      'paint-order': 'stroke',
      opacity: op,
    });
    t.textContent = txt;
    g.appendChild(t);
  }
  const topTxt = pack.status === 'breakUp' ? '箱体已上破 ' : '箱体上沿 ';
  const botTxt = pack.status === 'breakDn' ? '箱体已下破 ' : '箱体下沿 ';
  label(pack.top, topTxt + px(pack.top) + (pack.topTouches >= 2 ? ' · ' + pack.topTouches + '次' : ''), false);
  label(pack.bottom, botTxt + px(pack.bottom) + (pack.botTouches >= 2 ? ' · ' + pack.botTouches + '次' : ''), true);
  if (broke && pack.target != null) {
    const targetY = y(pack.target);
    const tx1 = Math.max(PAD.l, Math.min(xRight, xIndex(pack.breakI >= 0 ? pack.breakI : pack.boxStart)));
    g.appendChild(svgEl('line', {
      x1: tx1.toFixed(1),
      x2: xRight.toFixed(1), y1: targetY.toFixed(1), y2: targetY.toFixed(1),
      stroke: color, 'stroke-width': '1.15', 'stroke-dasharray': '2 5', opacity: '.72',
    }));
    const targetLab = svgEl('text', {
      x: (xRight - 4).toFixed(1), y: (targetY - 4).toFixed(1),
      fill: color, 'font-size': '10', 'font-weight': '650',
      'font-family': 'var(--font)', 'text-anchor': 'end',
      stroke: 'var(--bg)', 'stroke-width': '3', 'paint-order': 'stroke', opacity: '.8',
    });
    targetLab.textContent = '量度目标 ' + px(pack.target) + ' · 参考';
    g.appendChild(targetLab);
  }
  svg.appendChild(g);
}

export function drawHkld(svg, pack, vx, y, xRight) {
  if (!pack || !pack.ok) return;
  const x1 = vx(pack.fromI != null ? pack.fromI : 0);
  const x2 = xRight;
  function zone(loPx, hiPx, pxLine, color, lab, status) {
    if (loPx == null || hiPx == null || pxLine == null) return;
    const top = y(Math.max(loPx, hiPx));
    const bot = y(Math.min(loPx, hiPx));
    const fillOp = status === 'trigger' ? '.16' : (status === 'watch' ? '.11' : (status === 'block' ? '.05' : '.08'));
    svg.appendChild(svgEl('rect', {
      x: Math.min(x1, x2).toFixed(1),
      y: Math.min(top, bot).toFixed(1),
      width: Math.max(2, Math.abs(x2 - x1)).toFixed(1),
      height: Math.max(1.5, Math.abs(bot - top)).toFixed(1),
      fill: color,
      opacity: fillOp,
    }));
    const op = status === 'trigger' ? '.95' : (status === 'watch' ? '.82' : (status === 'block' ? '.42' : '.64'));
    const dash = status === 'trigger' ? '' : (status === 'watch' ? '5 4' : '4 5');
    const yy = y(pxLine);
    svg.appendChild(svgEl('line', {
      x1: x1.toFixed(1), x2: x2.toFixed(1),
      y1: yy.toFixed(1), y2: yy.toFixed(1),
      stroke: color, 'stroke-width': status === 'trigger' ? '1.6' : '1.2',
      'stroke-dasharray': dash, opacity: op,
    }));
    const t = svgEl('text', {
      x: (x2 - 4).toFixed(1),
      y: (yy - 4).toFixed(1),
      fill: color,
      'font-size': '10.5',
      'font-weight': status === 'trigger' ? '750' : '650',
      'font-family': 'var(--font)',
      'text-anchor': 'end',
      stroke: 'var(--bg)',
      'stroke-width': '3',
      'paint-order': 'stroke',
      opacity: op,
    });
    t.textContent = lab;
    svg.appendChild(t);
  }
  const longLab = (pack.kind === 'break' && pack.dir < 0)
    ? ((pack.status === 'trigger' ? '下破反转 ' : pack.status === 'watch' ? '下破预备 ' : '下破 ') + px(pack.breakLevel || pack.longPx))
    : pack.longStatus === 'trigger' ? ('低多推荐 ' + px(pack.longPx))
    : pack.longStatus === 'watch' ? ('低多预备 ' + px(pack.longPx))
    : pack.longStatus === 'block' ? ('低多顺势 ' + px(pack.longPx))
    : ('低多 ' + px(pack.longPx));
  const shortLab = (pack.kind === 'break' && pack.dir > 0)
    ? ((pack.status === 'trigger' ? '上破反转 ' : pack.status === 'watch' ? '上破预备 ' : '上破 ') + px(pack.breakLevel || pack.shortPx))
    : pack.shortStatus === 'trigger' ? ('高空推荐 ' + px(pack.shortPx))
    : pack.shortStatus === 'watch' ? ('高空预备 ' + px(pack.shortPx))
    : pack.shortStatus === 'block' ? ('高空顺势 ' + px(pack.shortPx))
    : ('高空 ' + px(pack.shortPx));
  const longLine = (pack.kind === 'break' && pack.dir < 0 && pack.breakLevel != null) ? pack.breakLevel : pack.longPx;
  const shortLine = (pack.kind === 'break' && pack.dir > 0 && pack.breakLevel != null) ? pack.breakLevel : pack.shortPx;
  zone(pack.longLo, pack.longHi, longLine, 'var(--up)', longLab, pack.longStatus);
  zone(pack.shortLo, pack.shortHi, shortLine, 'var(--down)', shortLab, pack.shortStatus);
  (pack.marks || []).forEach((mk) => {
    if (mk.i == null || mk.y == null) return;
    const xc = vx(mk.i);
    const yy = y(mk.y);
    const color = mk.dir > 0 ? 'var(--up)' : 'var(--down)';
    const gMk = svgEl('g', {});
    const tip = svgEl('title', {});
    tip.textContent = (mk.label || '') + (mk.px != null ? ' ' + px(mk.px) : '');
    gMk.appendChild(tip);
    if (mk.kind === 'break') {
      gMk.appendChild(svgEl('polygon', {
        points: mk.dir > 0
          ? xc.toFixed(1) + ',' + (yy - 7.5).toFixed(1) + ' ' + (xc - 6).toFixed(1) + ',' + (yy + 4).toFixed(1) + ' ' + (xc + 6).toFixed(1) + ',' + (yy + 4).toFixed(1)
          : xc.toFixed(1) + ',' + (yy + 7.5).toFixed(1) + ' ' + (xc - 6).toFixed(1) + ',' + (yy - 4).toFixed(1) + ' ' + (xc + 6).toFixed(1) + ',' + (yy - 4).toFixed(1),
        fill: color,
        opacity: '.92',
      }));
    } else {
      gMk.appendChild(svgEl('rect', {
        x: (xc - 3.4).toFixed(1),
        y: (yy - 3.4).toFixed(1),
        width: '6.8', height: '6.8',
        fill: color, opacity: '.9',
        rx: '1.1',
      }));
    }
    svg.appendChild(gMk);
  });
}

export function drawFib(svg, pack, xIndex, y, xRight, plotTop, plotBottom) {
  if (!pack || !pack.ok || !pack.levels || !pack.levels.length) return;
  const color = pack.dir > 0 ? 'var(--up)' : 'var(--down)';
  const gold = 'var(--warn)';
  const rawX1 = xIndex(Math.min(pack.start.i, pack.end.i));
  const x1 = Math.max(PAD.l, Math.min(xRight, rawX1));
  const x2 = xRight;
  const top = plotTop == null ? -20 : plotTop;
  const bot = plotBottom == null ? 1e9 : plotBottom;
  const opBase = pack.status === 'trigger' ? .95 : (pack.status === 'watch' ? .84 : .7);
  const swingSeg = clipSegmentX(
    xIndex(pack.start.i), y(pack.start.price),
    xIndex(pack.end.i), y(pack.end.price),
    PAD.l, xRight
  );
  if (swingSeg) {
    svg.appendChild(svgEl('line', {
      x1: swingSeg.x1.toFixed(1), x2: swingSeg.x2.toFixed(1),
      y1: swingSeg.y1.toFixed(1), y2: swingSeg.y2.toFixed(1),
      stroke: 'var(--accent)', 'stroke-width': '1.15',
      'stroke-dasharray': '4 4', opacity: '.55',
    }));
  }
  pack.points.forEach((pt) => {
    const pxX = xIndex(pt.i);
    if (pxX < PAD.l - 1 || pxX > xRight + 1) return;
    svg.appendChild(svgEl('circle', {
      cx: pxX.toFixed(1), cy: y(pt.price).toFixed(1),
      r: '2.8', fill: 'var(--accent)', opacity: '.85',
    }));
    const t = svgEl('text', {
      x: pxX.toFixed(1),
      y: (y(pt.price) + (pt.lab === '100%' ? 12 : -6)).toFixed(1),
      fill: 'var(--accent)',
      'font-size': '10',
      'font-weight': '700',
      'font-family': 'var(--font)',
      'text-anchor': 'middle',
      stroke: 'var(--bg)',
      'stroke-width': '3',
      'paint-order': 'stroke',
      opacity: '.88',
    });
    t.textContent = pt.lab;
    svg.appendChild(t);
  });
  const usedY = [];
  pack.levels.forEach((lv) => {
    const isGold = fibNear(lv.r, 0.618);
    const isHit = pack.hit && fibNear(pack.hit.r, lv.r);
    const stroke = isGold ? gold : color;
    const width = isGold || isHit ? '1.55' : ((fibNear(lv.r, 0) || fibNear(lv.r, 1)) ? '1.25' : '1');
    const op = String((lv.ext ? 0.42 : (isGold || isHit ? opBase : (lv.key ? opBase * 0.78 : opBase * 0.5))).toFixed(2));
    const dash = lv.ext ? '2 4' : ((fibNear(lv.r, 0) || fibNear(lv.r, 1) || isGold) ? '' : '5 4');
    const yy = y(lv.price);
    if (yy < top - 8 || yy > bot + 8) return;
    if (isHit && pack.radius) {
      const top = y(lv.price + pack.radius);
      const bot = y(lv.price - pack.radius);
      svg.appendChild(svgEl('rect', {
        x: Math.min(x1, x2).toFixed(1),
        y: Math.min(top, bot).toFixed(1),
        width: Math.max(2, Math.abs(x2 - x1)).toFixed(1),
        height: Math.max(1.5, Math.abs(bot - top)).toFixed(1),
        fill: stroke,
        opacity: pack.status === 'trigger' ? '.12' : '.08',
      }));
    }
    svg.appendChild(svgEl('line', {
      x1: x1.toFixed(1), x2: x2.toFixed(1),
      y1: yy.toFixed(1), y2: yy.toFixed(1),
      stroke: stroke, 'stroke-width': width,
      'stroke-dasharray': dash, opacity: op,
    }));
    if (!(lv.key || fibNear(lv.r, 0) || fibNear(lv.r, 1) || isGold || lv.ext)) return;
    let labY = yy - 4;
    usedY.forEach((uy) => {
      if (Math.abs(uy - labY) < 11) labY = uy - 11;
    });
    usedY.push(labY);
    const lab = svgEl('text', {
      x: (x2 - 4).toFixed(1),
      y: labY.toFixed(1),
      fill: stroke,
      'font-size': isGold || isHit ? '10.5' : '10',
      'font-weight': isGold || isHit ? '750' : '650',
      'font-family': 'var(--font)',
      'text-anchor': 'end',
      stroke: 'var(--bg)',
      'stroke-width': '3',
      'paint-order': 'stroke',
      opacity: op,
    });
    lab.textContent = (isGold ? '斐波那契 ' : '') + fibRatioText(lv.r) + ' ' + px(lv.price);
    svg.appendChild(lab);
  });
}

const DIV3_GUIDE_COLOR = { macd: 'var(--accent)', kdj: 'var(--warn)', rsi: 'var(--accent-2)' };

function guideInView(g, start, end) {
  if (!g || !g.ready || g.anchorI == null || g.extremeI == null || g.anchorI < 0 || g.extremeI < 0) return false;
  const lo = Math.min(g.anchorI, g.extremeI);
  const hi = Math.max(g.anchorI, g.extremeI, g.i || 0);
  return hi >= start && lo < end;
}

function drawDiv3Legend(svg, pack) {
  const guides = pack.guides || [];
  if (!guides.length) return;
  const x = PAD.l + 8;
  const y0 = PAD.t + 8;
  const rowH = 13;
  const w = 118;
  const h = 8 + rowH * (guides.length + 1);
  const g = svgEl('g', {});
  const tip = svgEl('title', {});
  tip.textContent = guides.map(guideLine).join('。') + '。分项线只说明各自最近一段比较，三项同时背离才是三维信号。';
  g.appendChild(tip);
  g.appendChild(svgEl('rect', {
    x: x, y: y0, width: w, height: h, rx: 6,
    fill: 'var(--bg)', stroke: 'var(--border)', 'stroke-width': '1', opacity: '.92',
  }));
  const head = svgEl('text', {
    x: x + 8, y: y0 + 14,
    fill: 'var(--ink-2)', 'font-size': '10', 'font-weight': '750', 'font-family': 'var(--font)',
  });
  head.textContent = guideHeader(guides);
  g.appendChild(head);
  guides.forEach((item, idx) => {
    const color = item.diverged
      ? (item.dir > 0 ? 'var(--up)' : 'var(--down)')
      : (DIV3_GUIDE_COLOR[item.id] || 'var(--ink-3)');
    const yy = y0 + 16 + rowH * (idx + 1);
    g.appendChild(svgEl('circle', {
      cx: x + 12, cy: yy - 3, r: item.diverged ? 3.2 : 2.4,
      fill: item.diverged ? color : 'none',
      stroke: color, 'stroke-width': '1.3',
      opacity: item.ready ? '1' : '.45',
    }));
    const lab = svgEl('text', {
      x: x + 22, y: yy,
      fill: item.ready ? 'var(--ink-1)' : 'var(--ink-3)',
      'font-size': '10', 'font-family': 'var(--font)',
    });
    const side = !item.ready ? '交叉不足' : (item.diverged ? (item.dir > 0 ? '底背离' : '顶背离') : '未背离');
    lab.textContent = (item.tag || item.name) + '  ' + side;
    g.appendChild(lab);
  });
  svg.appendChild(g);
}

export function drawDiv3(svg, pack, xIndex, y, view, xRight) {
  if (!pack || !pack.ok || !view) return;
  const start = view.start;
  const end = view.start + view.count;
  const rightBound = xRight != null ? xRight : (xIndex(end - 0.5));
  (pack.guides || []).forEach((g, idx) => {
    if (!guideInView(g, start, end) || g.anchorPx == null || g.extremePx == null) return;
    const seg = clipSegmentX(
      xIndex(g.anchorI), y(g.anchorPx),
      xIndex(g.extremeI), y(g.extremePx),
      PAD.l, rightBound
    );
    if (!seg) return;
    const color = DIV3_GUIDE_COLOR[g.id] || 'var(--ink-2)';
    const grp = svgEl('g', {});
    const tip = svgEl('title', {});
    tip.textContent = guideLine(g) + '。这是分项辅助线，不是三维共振。';
    grp.appendChild(tip);
    grp.appendChild(svgEl('line', {
      x1: seg.x1.toFixed(1),
      y1: seg.y1.toFixed(1),
      x2: seg.x2.toFixed(1),
      y2: seg.y2.toFixed(1),
      stroke: color,
      'stroke-width': g.diverged ? '1.35' : '1',
      'stroke-dasharray': g.id === 'kdj' ? '2 2' : (g.id === 'rsi' ? '7 3' : '4 3'),
      opacity: g.diverged ? '.88' : '.42',
    }));
    const xc = xIndex(g.extremeI);
    if (xc >= PAD.l - 1 && xc <= rightBound + 1) {
      const yy = y(g.extremePx) + (idx - 1) * 11;
      grp.appendChild(svgEl('circle', {
        cx: xc.toFixed(1), cy: y(g.extremePx).toFixed(1), r: g.diverged ? '2.6' : '2',
        fill: g.diverged ? color : 'var(--bg)', stroke: color, 'stroke-width': '1.2',
        opacity: g.diverged ? '.95' : '.7',
      }));
      const lab = svgEl('text', {
        x: (xc + 6).toFixed(1),
        y: yy.toFixed(1),
        fill: color,
        'font-size': '9.5',
        'font-weight': '750',
        'font-family': 'var(--font)',
        stroke: 'var(--bg)',
        'stroke-width': '3',
        'paint-order': 'stroke',
        opacity: g.diverged ? '.95' : '.7',
      });
      lab.textContent = g.lab || g.tag || '';
      grp.appendChild(lab);
    }
    svg.appendChild(grp);
  });
  drawDiv3Legend(svg, pack);
  (pack.marks || []).forEach((mk) => {
    const inside = [mk.i, mk.anchorI, mk.extremeI].some((i) => i >= start && i < end);
    if (!inside) return;
    const color = mk.dir > 0 ? 'var(--up)' : 'var(--down)';
    const live = mk.status === 'trigger';
    const op = live ? '.92' : '.62';
    const dash = live ? '' : '4 3';
    const g = svgEl('g', {});
    const tip = svgEl('title', {});
    tip.textContent = (mk.lab || '三维背离') + '。价格与 MACD、KDJ、RSI 不同步，只描述动能，不是下单指令。';
    g.appendChild(tip);
    if (mk.anchorI != null && mk.extremeI != null && mk.anchorI >= 0 && mk.extremeI >= 0 && mk.anchorPx != null && mk.extremePx != null) {
      const mSeg = clipSegmentX(
        xIndex(mk.anchorI), y(mk.anchorPx),
        xIndex(mk.extremeI), y(mk.extremePx),
        PAD.l, rightBound
      );
      if (mSeg) {
        g.appendChild(svgEl('line', {
          x1: mSeg.x1.toFixed(1),
          y1: mSeg.y1.toFixed(1),
          x2: mSeg.x2.toFixed(1),
          y2: mSeg.y2.toFixed(1),
          stroke: color,
          'stroke-width': live ? '1.4' : '1.15',
          'stroke-dasharray': dash,
          opacity: op,
        }));
      }
      [mk.anchorI, mk.extremeI].forEach((idx, n) => {
        const pxX = xIndex(idx);
        if (pxX < PAD.l - 1 || pxX > rightBound + 1) return;
        const pxv = n === 0 ? mk.anchorPx : mk.extremePx;
        g.appendChild(svgEl('circle', {
          cx: pxX.toFixed(1),
          cy: y(pxv).toFixed(1),
          r: live ? '2.4' : '2',
          fill: color,
          opacity: op,
        }));
      });
    }
    const xc = xIndex(mk.extremeI != null && mk.extremeI >= 0 ? mk.extremeI : mk.i);
    if (xc >= PAD.l - 1 && xc <= rightBound + 1) {
      const yy = y(mk.extremePx != null ? mk.extremePx : mk.anchorPx);
      const s = 4.2;
      g.appendChild(svgEl('polygon', {
        points: [
          (xc).toFixed(1) + ',' + (yy - s).toFixed(1),
          (xc + s).toFixed(1) + ',' + yy.toFixed(1),
          xc.toFixed(1) + ',' + (yy + s).toFixed(1),
          (xc - s).toFixed(1) + ',' + yy.toFixed(1),
        ].join(' '),
        fill: live ? color : 'var(--bg)',
        stroke: color,
        'stroke-width': '1.3',
        opacity: op,
      }));
      const lab = svgEl('text', {
        x: xc.toFixed(1),
        y: (mk.dir > 0 ? yy + 16 : yy - 8).toFixed(1),
        fill: color,
        'font-size': '10.5',
        'font-weight': '750',
        'font-family': 'var(--font)',
        'text-anchor': 'middle',
        stroke: 'var(--bg)',
        'stroke-width': '3',
        'paint-order': 'stroke',
        opacity: op,
      });
      lab.textContent = mk.lab || (mk.dir > 0 ? '三维底背离' : '三维顶背离');
      g.appendChild(lab);
    }
    svg.appendChild(g);
  });
}

function estimatePatternLabelWidth(str, fontSize) {
  const scale = (fontSize || 11) / 10;
  let w = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    w += (s.charCodeAt(i) > 255 ? 10.8 : 6.4) * scale;
  }
  return Math.ceil(w + 6);
}

function boxesOverlap(a, b, pad) {
  const p = pad || 0;
  return a.x1 - p < b.x2 && a.x2 + p > b.x1 && a.y1 - p < b.y2 && a.y2 + p > b.y1;
}

export function layoutPatternPlan(pack, vis, view, x, vx, y, xRight, plotTop, plotBottom) {
  if (!pack || !pack.ok) return { order: null, marks: [], hitMarks: [], candleBoxes: [] };
  const topBound = plotTop != null ? plotTop : PAD.t;
  const botBound = plotBottom != null ? plotBottom : 360;
  const active = pack.active;
  const i0 = Math.max(0, (view && view.start) || 0);
  const nVis = (vis && vis.length) || 0;
  const slotW = (xRight - PAD.l) / Math.max(1, (view && view.count) || nVis || 1);
  const halfSlot = Math.max(3.5, slotW * 0.55);

  const candleBoxes = [];
  for (let vi = 0; vi < nVis; vi++) {
    const bar = vis[vi];
    const xc = x(vi);
    const yH = y(bar.h);
    const yL = y(bar.l);
    const yO = y(bar.o);
    const yC = y(bar.c);
    candleBoxes.push({
      vi: vi,
      gi: i0 + vi,
      xc: xc,
      x1: xc - halfSlot,
      x2: xc + halfSlot,
      yTop: Math.min(yH, yL),
      yBot: Math.max(yH, yL),
      bodyTop: Math.min(yO, yC),
      bodyBot: Math.max(yO, yC),
    });
  }
  const lastCandleRight = nVis > 0 ? candleBoxes[nVis - 1].x2 : PAD.l;
  const occupiedBoxes = [];

  // 1. 先计算触发形态 K 线上的 Buy / Sell 气泡位置，避开覆盖范围内所有相邻 K 线
  const marksLayout = [];
  (pack.marks || []).forEach((mk) => {
    const vi = mk.i - i0;
    if (vi < 0 || vi >= nVis) return;
    const cb = candleBoxes[vi];
    const xc = cb.xc;
    const isLong = mk.dir > 0;
    const isActive = !!(active && active.i === mk.i);
    const pillW = isActive ? 32 : 28;
    const pillH = 14;
    const tipH = 4;
    const gap = 3.5;

    let spanTop = cb.yTop;
    let spanBot = cb.yBot;
    for (let j = 0; j < candleBoxes.length; j++) {
      const c = candleBoxes[j];
      if (c.x2 >= xc - pillW / 2 - 2 && c.x1 <= xc + pillW / 2 + 2) {
        if (c.yTop < spanTop) spanTop = c.yTop;
        if (c.yBot > spanBot) spanBot = c.yBot;
      }
    }

    let belowSide = isLong;
    let pillTop = belowSide
      ? (spanBot + tipH + gap)
      : (spanTop - tipH - pillH - gap);

    for (let j = 0; j < occupiedBoxes.length; j++) {
      const ob = occupiedBoxes[j];
      if (ob.kind === 'mark' && ob.belowSide === belowSide &&
          ob.x2 >= xc - pillW / 2 - 2 && ob.x1 <= xc + pillW / 2 + 2) {
        pillTop = belowSide
          ? Math.max(pillTop, ob.y2 + tipH + 2)
          : Math.min(pillTop, ob.y1 - tipH - pillH - 2);
      }
    }

    const clampedTop = Math.max(topBound + 2, Math.min(botBound - pillH - 2, pillTop));
    const overlapsSpan = (topVal) => (topVal - 1 < spanBot + 1 && topVal + pillH + 1 > spanTop - 1);
    if (overlapsSpan(clampedTop)) {
      const altBelow = !belowSide;
      const altTop = altBelow
        ? (spanBot + tipH + gap)
        : (spanTop - tipH - pillH - gap);
      const altClamped = Math.max(topBound + 2, Math.min(botBound - pillH - 2, altTop));
      if (!overlapsSpan(altClamped)) {
        belowSide = altBelow;
        pillTop = altClamped;
      } else {
        pillTop = clampedTop;
      }
    } else {
      pillTop = clampedTop;
    }

    const anchorY = belowSide ? cb.yBot : cb.yTop;
    const tipY = belowSide ? (pillTop - tipH) : (pillTop + pillH + tipH);
    const box = {
      kind: 'mark',
      belowSide: belowSide,
      x1: xc - pillW / 2 - 2,
      y1: Math.min(pillTop, tipY) - 1,
      x2: xc + pillW / 2 + 2,
      y2: Math.max(pillTop + pillH, tipY) + 1,
    };
    occupiedBoxes.push(box);
    marksLayout.push({
      mk: mk,
      vi: vi,
      xc: xc,
      isLong: isLong,
      isActive: isActive,
      belowSide: belowSide,
      pillW: pillW,
      pillH: pillH,
      tipH: tipH,
      pillTop: pillTop,
      anchorY: anchorY,
      tipY: tipY,
      box: box,
    });
  });

  // 2. 仿示例图样式：无色块遮挡，用等长实线向右延伸至 K 线外侧并截停，文字紧接在线端右侧同行居中显示
  let orderLayout = null;
  const hitMarks = [];
  if (active && active.entry != null) {
    const x1 = Math.max(PAD.l, Math.min(xRight - 18, vx(active.i)));
    const yEntry = y(active.entry);
    const ySl = y(active.sl);
    const yTp1 = y(active.tp1);
    const yTp2 = y(active.tp2);

    const rawLines = [
      {
        key: 'sl', price: active.sl, yy: ySl,
        color: active.breakeven ? '#15803d' : '#dc2626',
        dash: '', w: '1.35',
        lab: (active.breakeven ? '保本止损(' : '止损(') + px(active.sl) + ')',
      },
      {
        key: 'entry', price: active.entry, yy: yEntry,
        color: '#b45309',
        dash: '', w: '1.85',
        lab: '入场(' + px(active.entry) + ')',
      },
      {
        key: 'tp1', price: active.tp1, yy: yTp1,
        color: '#15803d',
        dash: '', w: '1.45',
        lab: 'TP1(' + px(active.tp1) + ')' + (active.hitTp1 ? ' ✓' : ''),
      },
      {
        key: 'tp2', price: active.tp2, yy: yTp2,
        color: '#166534',
        dash: '', w: '1.25',
        lab: 'TP2(' + px(active.tp2) + ')',
      },
    ];

    const visibleLines = rawLines.filter((row) => Number.isFinite(row.yy) && row.yy >= topBound - 4 && row.yy <= botBound + 4);
    const minCenterY = topBound + 9;
    const maxCenterY = botBound - 9;
    const minGap = 15;
    const labelFontSize = 11.5;
    const halfLabH = 7;

    // 按屏幕 Y 从上到下排序，默认文字与水平线同行居中对齐，过近时双向单调撑开且不倒序
    const sorted = visibleLines.slice().sort((a, b) => a.yy - b.yy);
    sorted.forEach((row) => {
      row.labelW = estimatePatternLabelWidth(row.lab, labelFontSize);
      row.labY = Math.max(minCenterY, Math.min(maxCenterY, row.yy));
    });

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].labY < sorted[i - 1].labY + minGap) {
        sorted[i].labY = sorted[i - 1].labY + minGap;
      }
    }
    if (sorted.length) {
      sorted[sorted.length - 1].labY = Math.min(maxCenterY, sorted[sorted.length - 1].labY);
      for (let i = sorted.length - 2; i >= 0; i--) {
        if (sorted[i].labY > sorted[i + 1].labY - minGap) {
          sorted[i].labY = Math.max(minCenterY, sorted[i + 1].labY - minGap);
        }
      }
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].labY < sorted[i - 1].labY + minGap) {
          sorted[i].labY = Math.min(maxCenterY, sorted[i - 1].labY + minGap);
        }
      }
    }

    const maxLabelW = sorted.reduce((m, r) => Math.max(m, r.labelW || 92), 92);
    const gapLineToText = 9;
    const minRunway = 22;
    const hasInlineRightSpace = (xRight - lastCandleRight) >= (maxLabelW + gapLineToText + minRunway + 4);

    if (hasInlineRightSpace) {
      // 示例图标准形态：线从入场棒向右延伸至最新 K 线外侧一段留白后截停，文字在线端右侧同行对齐
      const idealExtend = Math.min(64, Math.max(40, slotW * 6));
      const maxLineX2 = xRight - maxLabelW - gapLineToText - 6;
      const lineX2 = Math.max(
        lastCandleRight + minRunway,
        Math.min(maxLineX2, Math.max(x1 + 56, lastCandleRight + idealExtend))
      );
      const baseLabX = lineX2 + gapLineToText;

      sorted.forEach((row) => {
        const wLab = row.labelW;
        let lx = Math.min(xRight - wLab - 4, baseLabX);
        let box = {
          kind: 'label',
          x1: lx - 2,
          y1: row.labY - halfLabH,
          x2: lx + wLab + 2,
          y2: row.labY + halfLabH,
        };
        for (let j = 0; j < occupiedBoxes.length; j++) {
          const ob = occupiedBoxes[j];
          if (ob.kind === 'mark' && boxesOverlap(box, ob, 2)) {
            const shifted = Math.min(xRight - wLab - 4, ob.x2 + 6);
            if (shifted > lx) {
              lx = shifted;
              box = {
                kind: 'label',
                x1: lx - 2,
                y1: row.labY - halfLabH,
                x2: lx + wLab + 2,
                y2: row.labY + halfLabH,
              };
            }
          }
        }
        row.lineX1 = x1;
        row.lineX2 = lineX2;
        row.labX = lx;
        row.anchor = 'start';
        row.inlineMode = true;
        row.box = box;
        occupiedBoxes.push(box);
      });

      orderLayout = {
        x1: x1,
        x2: lineX2,
        xRight: xRight,
        inlineMode: true,
        fontSize: labelFontSize,
        yEntry: yEntry,
        ySl: ySl,
        yTp1: yTp1,
        yTp2: yTp2,
        lines: visibleLines,
      };
    } else {
      // 历史满屏回看视窗（右侧无足够留白）：沿水平线搜索与 K 线及已有标签零重叠/最小重叠槽位
      sorted.forEach((row) => {
        const wLab = row.labelW;
        const leftBound = PAD.l + 6;
        const maxX = Math.max(leftBound, xRight - wLab - 6);
        const inZoneMinX = Math.max(leftBound, Math.min(x1 + 6, maxX));
        const candX = [];
        if (lastCandleRight + 8 + wLab <= xRight - 2) candX.push(Math.max(leftBound, lastCandleRight + 8));
        for (let cx = maxX; cx >= inZoneMinX; cx -= 12) candX.push(cx);
        if (candX[candX.length - 1] !== inZoneMinX) candX.push(inZoneMinX);
        const leftOfEntry = Math.min(maxX, x1 - wLab - 8);
        for (let cx = leftOfEntry; cx >= leftBound; cx -= 14) candX.push(cx);

        const candY = [row.labY];
        [row.yy, row.yy - 11, row.yy + 11, row.yy - 20, row.yy + 20].forEach((rawY) => {
          const clamped = Math.max(minCenterY, Math.min(maxCenterY, rawY));
          if (!candY.some((ey) => Math.abs(ey - clamped) < 2)) candY.push(clamped);
        });

        let bestX = maxX;
        let bestY = row.labY;
        let bestScore = Infinity;

        for (let yi = 0; yi < candY.length; yi++) {
          const cy = candY[yi];
          for (let xi = 0; xi < candX.length; xi++) {
            const cx = candX[xi];
            const box = {
              kind: 'label',
              x1: cx - 2,
              y1: cy - halfLabH,
              x2: cx + wLab + 2,
              y2: cy + halfLabH,
            };
            const horizDist = cx >= x1 ? (maxX - cx) * 0.015 : (x1 - cx) * 0.03 + 2;
            let score = Math.abs(cy - row.labY) * 0.4 + horizDist;
            for (let j = 0; j < occupiedBoxes.length; j++) {
              if (boxesOverlap(box, occupiedBoxes[j], 1.5)) {
                score += 1e5;
                break;
              }
            }
            if (score >= bestScore) continue;
            for (let j = 0; j < candleBoxes.length; j++) {
              const c = candleBoxes[j];
              if (c.x2 < box.x1 - 1 || c.x1 > box.x2 + 1) continue;
              if (c.bodyTop - 1 < box.y2 && c.bodyBot + 1 > box.y1) {
                score += 120;
              } else if (c.yTop - 1 < box.y2 && c.yBot + 1 > box.y1) {
                score += 45;
              } else if (Math.max(box.y1 - c.yBot, c.yTop - box.y2) < 3) {
                score += 6;
              }
            }
            if (score < bestScore) {
              bestScore = score;
              bestX = cx;
              bestY = cy;
            }
          }
        }

        row.lineX1 = Math.min(x1, bestX);
        row.lineX2 = xRight;
        row.labX = bestX;
        row.labY = bestY;
        row.anchor = 'start';
        row.inlineMode = false;
        row.box = {
          kind: 'label',
          x1: bestX - 2,
          y1: bestY - halfLabH,
          x2: bestX + wLab + 2,
          y2: bestY + halfLabH,
        };
        occupiedBoxes.push(row.box);
      });

      orderLayout = {
        x1: x1,
        x2: xRight,
        xRight: xRight,
        inlineMode: false,
        fontSize: labelFontSize,
        yEntry: yEntry,
        ySl: ySl,
        yTp1: yTp1,
        yTp2: yTp2,
        lines: visibleLines,
      };
    }

    // 若已触达 TP1 且触达棒在当前视窗内，在触达棒外侧干净处标出 TP1 ✓
    if (active.hitTp1 && active.hitTp1I != null && active.hitTp1I >= 0) {
      const vi = active.hitTp1I - i0;
      if (vi >= 0 && vi < nVis) {
        const cb = candleBoxes[vi];
        const hitText = 'TP1 ✓';
        const hitW = estimatePatternLabelWidth(hitText, 11);
        let spanTop = cb.yTop;
        let spanBot = cb.yBot;
        for (let j = 0; j < candleBoxes.length; j++) {
          const c = candleBoxes[j];
          if (c.x2 >= cb.xc - hitW / 2 - 2 && c.x1 <= cb.xc + hitW / 2 + 2) {
            if (c.yTop < spanTop) spanTop = c.yTop;
            if (c.yBot > spanBot) spanBot = c.yBot;
          }
        }
        const below = active.dir < 0;
        let hy = below ? (spanBot + 11) : (spanTop - 11);
        hy = Math.max(minCenterY, Math.min(maxCenterY, hy));
        const hBox = {
          kind: 'hit',
          x1: cb.xc - hitW / 2 - 2,
          y1: hy - 7,
          x2: cb.xc + hitW / 2 + 2,
          y2: hy + 7,
        };
        const blocked = occupiedBoxes.some((ob) => boxesOverlap(hBox, ob, 1)) ||
          candleBoxes.some((c) => boxesOverlap(hBox, { x1: c.x1, y1: c.yTop, x2: c.x2, y2: c.yBot }, 0));
        if (!blocked) {
          occupiedBoxes.push(hBox);
          hitMarks.push({ text: hitText, x: cb.xc, y: hy, color: '#15803d', box: hBox });
        }
      }
    }
  } else if (pack.lastClosed && pack.lastClosed.status === 'tp2' && pack.lastClosed.exitI >= 0) {
    const tr = pack.lastClosed;
    const vi = tr.exitI - i0;
    if (vi >= 0 && vi < nVis) {
      const cb = candleBoxes[vi];
      const hitText = 'TP2 ✓';
      const hitW = estimatePatternLabelWidth(hitText, 11);
      let spanTop = cb.yTop;
      let spanBot = cb.yBot;
      for (let j = 0; j < candleBoxes.length; j++) {
        const c = candleBoxes[j];
        if (c.x2 >= cb.xc - hitW / 2 - 2 && c.x1 <= cb.xc + hitW / 2 + 2) {
          if (c.yTop < spanTop) spanTop = c.yTop;
          if (c.yBot > spanBot) spanBot = c.yBot;
        }
      }
      const below = tr.dir < 0;
      const hy = Math.max(topBound + 9, Math.min(botBound - 9, below ? (spanBot + 11) : (spanTop - 11)));
      const hBox = {
        kind: 'hit',
        x1: cb.xc - hitW / 2 - 2,
        y1: hy - 7,
        x2: cb.xc + hitW / 2 + 2,
        y2: hy + 7,
      };
      const blocked = occupiedBoxes.some((ob) => boxesOverlap(hBox, ob, 1)) ||
        candleBoxes.some((c) => boxesOverlap(hBox, { x1: c.x1, y1: c.yTop, x2: c.x2, y2: c.yBot }, 0));
      if (!blocked) {
        occupiedBoxes.push(hBox);
        hitMarks.push({ text: hitText, x: cb.xc, y: hy, color: '#15803d', box: hBox });
      }
    }
  }

  return {
    order: orderLayout,
    marks: marksLayout,
    hitMarks: hitMarks,
    candleBoxes: candleBoxes,
    lastCandleRight: lastCandleRight,
  };
}

export function drawPatternPlan(svg, pack, vis, view, x, vx, y, xRight, plotTop, plotBottom) {
  if (!pack || !pack.ok) return;
  const topBound = plotTop != null ? plotTop : PAD.t;
  const botBound = plotBottom != null ? plotBottom : 360;
  const layout = layoutPatternPlan(pack, vis, view, x, vx, y, xRight, topBound, botBound);

  // 1. 绘制当前持仓的止损 / 入场 / TP1 / TP2 水平线（置于 K 线下方，线端留白后同行标注文字）
  if (layout.order) {
    const ord = layout.order;
    const gLines = svgEl('g', { class: 'pattern-order-lines', 'pointer-events': 'none' });
    const gOrder = svgEl('g', { class: 'pattern-order-overlay' });

    ord.lines.forEach((row) => {
      const lx1 = row.lineX1 != null ? row.lineX1 : ord.x1;
      const lx2 = row.lineX2 != null ? row.lineX2 : ord.x2;
      const drawSeg = (xa, xb) => {
        if (xb - xa < 1) return;
        gLines.appendChild(svgEl('line', {
          x1: xa.toFixed(1),
          x2: xb.toFixed(1),
          y1: row.yy.toFixed(1),
          y2: row.yy.toFixed(1),
          stroke: row.color,
          'stroke-width': row.w,
          'stroke-dasharray': row.dash,
          opacity: row.key === 'entry' ? '.95' : '.88',
        }));
      };

      if (row.inlineMode) {
        // 线在文字左侧干净截停，不穿过文字
        drawSeg(lx1, lx2);
        if (Math.abs(row.labY - row.yy) > 3.5) {
          gOrder.appendChild(svgEl('line', {
            x1: lx2.toFixed(1),
            y1: row.yy.toFixed(1),
            x2: (row.labX - 3).toFixed(1),
            y2: row.labY.toFixed(1),
            stroke: row.color,
            'stroke-width': '1',
            'stroke-dasharray': '2 2',
            opacity: '.65',
            'pointer-events': 'none',
          }));
        }
      } else if (Math.abs(row.labY - row.yy) < 6) {
        // 历史满屏同行显示时，在文字盒左右断开线条，不让横线穿过文字
        drawSeg(lx1, Math.min(lx2, row.labX - 4));
        drawSeg(Math.max(lx1, row.labX + row.labelW + 4), lx2);
      } else {
        drawSeg(lx1, lx2);
      }

      const t = svgEl('text', {
        x: row.labX.toFixed(1),
        y: row.labY.toFixed(1),
        fill: row.color,
        'font-size': String(ord.fontSize || 11.5),
        'font-weight': '750',
        'font-family': 'var(--font-mono)',
        'text-anchor': row.anchor || 'start',
        'dominant-baseline': 'central',
        stroke: 'var(--bg)',
        'stroke-width': '3.2',
        'paint-order': 'stroke',
        opacity: '.98',
      });
      t.textContent = row.lab;
      gOrder.appendChild(t);
    });

    const candlesEl = svg.querySelector ? svg.querySelector('#ck-candles') : null;
    if (candlesEl && candlesEl.parentNode === svg) {
      svg.insertBefore(gLines, candlesEl);
    } else {
      svg.appendChild(gLines);
    }
    svg.appendChild(gOrder);
  }

  // 1.5 触达 TP1 / TP2 时的勾号标注
  if (layout.hitMarks && layout.hitMarks.length) {
    const gHit = svgEl('g', { class: 'pattern-hit-marks', 'pointer-events': 'none' });
    layout.hitMarks.forEach((hm) => {
      const t = svgEl('text', {
        x: hm.x.toFixed(1),
        y: hm.y.toFixed(1),
        fill: hm.color,
        'font-size': '11',
        'font-weight': '800',
        'font-family': 'var(--font-mono)',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        stroke: 'var(--bg)',
        'stroke-width': '3.2',
        'paint-order': 'stroke',
      });
      t.textContent = hm.text;
      gHit.appendChild(t);
    });
    svg.appendChild(gHit);
  }

  // 2. 在触发形态的 K 线上绘制 Buy / Sell 气泡标记
  layout.marks.forEach((item) => {
    const mk = item.mk;
    const xc = item.xc;
    const isLong = item.isLong;
    const isActive = item.isActive;
    const belowSide = item.belowSide;
    const fill = isLong ? 'var(--up)' : '#2f7bf6';
    const pillW = item.pillW;
    const pillH = item.pillH;
    const tipH = item.tipH;
    const pillTop = item.pillTop;
    const gMk = svgEl('g', {
      class: 'pattern-signal-mark',
      'data-pattern-dir': isLong ? 'long' : 'short',
      opacity: isActive ? '1' : '.78',
    });
    const title = svgEl('title', {});
    title.textContent = (isLong ? '做多信号' : '做空信号') + ' · ' + mk.pattern.name +
      '\n开仓: ' + px(mk.entry) + '  止损: ' + px(mk.sl) +
      '\nTP1: ' + px(mk.tp1) + '  TP2: ' + px(mk.tp2) +
      '\n时段: ' + (mk.session ? mk.session.name : '');
    gMk.appendChild(title);

    // 若为避开邻近长影线而外移了气泡，用细虚线连接到触发 K 线极值点
    if (Math.abs(item.tipY - item.anchorY) > 4.5) {
      gMk.appendChild(svgEl('line', {
        x1: xc.toFixed(1),
        x2: xc.toFixed(1),
        y1: (belowSide ? item.anchorY + 1.5 : item.anchorY - 1.5).toFixed(1),
        y2: item.tipY.toFixed(1),
        stroke: fill,
        'stroke-width': '1',
        'stroke-dasharray': '2 2',
        opacity: '.75',
      }));
    }

    // 指向 K 线的小三角
    const triPts = belowSide
      ? (xc.toFixed(1) + ',' + (pillTop - tipH).toFixed(1) + ' ' + (xc - 3.4).toFixed(1) + ',' + (pillTop + 0.5).toFixed(1) + ' ' + (xc + 3.4).toFixed(1) + ',' + (pillTop + 0.5).toFixed(1))
      : (xc.toFixed(1) + ',' + (pillTop + pillH + tipH).toFixed(1) + ' ' + (xc - 3.4).toFixed(1) + ',' + (pillTop + pillH - 0.5).toFixed(1) + ' ' + (xc + 3.4).toFixed(1) + ',' + (pillTop + pillH - 0.5).toFixed(1));
    gMk.appendChild(svgEl('polygon', { points: triPts, fill: fill }));
    gMk.appendChild(svgEl('rect', {
      x: (xc - pillW / 2).toFixed(1),
      y: pillTop.toFixed(1),
      width: String(pillW),
      height: String(pillH),
      rx: '3',
      fill: fill,
    }));
    const lab = svgEl('text', {
      x: xc.toFixed(1),
      y: (pillTop + 10.2).toFixed(1),
      fill: '#ffffff',
      'font-size': '9.5',
      'font-weight': '750',
      'font-family': 'var(--font)',
      'text-anchor': 'middle',
    });
    lab.textContent = isLong ? 'Buy' : 'Sell';
    gMk.appendChild(lab);
    svg.appendChild(gMk);
  });
}

export function drawPatSr(svg, pack, xIndex, y, xRight, plotTop, plotBottom, lastPx) {
  if (!pack || !pack.ok) return;
  const topBound = plotTop != null ? plotTop : PAD.t;
  const botBound = plotBottom != null ? plotBottom : 360;
  const bounds = indexBoundsForX(xIndex, PAD.l, xRight);
  const gRoot = svgEl('g', { class: 'patsr-overlay' });
  const usedY = [];

  function placeLabelY(rawY) {
    let ly = Math.max(topBound + 11, Math.min(botBound - 5, rawY));
    for (let pass = 0; pass < 3; pass++) {
      usedY.forEach((uy) => {
        if (Math.abs(uy - ly) < 12.5) {
          ly = ly <= uy ? Math.max(topBound + 11, uy - 12.5) : Math.min(botBound - 5, uy + 12.5);
        }
      });
    }
    usedY.push(ly);
    return ly;
  }

  // 1. 经典价格结构形态骨架线（W底 / M顶 / 三重底 / 三重顶 / 头肩）
  (pack.shapes || []).forEach((sh) => {
    if (!sh || !sh.points || sh.points.length < 3) return;
    let d = '';
    for (let k = 0; k < sh.points.length - 1; k++) {
      const pA = sh.points[k];
      const pB = sh.points[k + 1];
      const seg = clipSegmentX(
        xIndex(pA.i), y(pA.price),
        xIndex(pB.i), y(pB.price),
        PAD.l, xRight
      );
      if (!seg) continue;
      d += 'M' + seg.x1.toFixed(1) + ',' + seg.y1.toFixed(1) +
        'L' + seg.x2.toFixed(1) + ',' + seg.y2.toFixed(1);
    }
    if (!d) return;

    const color = sh.dir > 0 ? 'var(--up)' : 'var(--down)';
    const gSh = svgEl('g', { class: 'patsr-shape', 'data-patsr-code': sh.code });
    const tip = svgEl('title', {});
    tip.textContent = sh.name + ' 结构形态' +
      (sh.basePrice != null ? (' · 形态位 ' + px(sh.basePrice)) : '') +
      (sh.neckPrice != null ? (' · 颈线 ' + px(sh.neckPrice)) : '');
    gSh.appendChild(tip);

    gSh.appendChild(svgEl('path', {
      d: d, fill: 'none', stroke: color,
      'stroke-width': '1.3', 'stroke-dasharray': '4 3',
      'stroke-linejoin': 'round', opacity: '.58',
    }));
    sh.points.forEach((pt) => {
      const cx = xIndex(pt.i);
      if (cx < PAD.l - 1 || cx > xRight + 1) return;
      gSh.appendChild(svgEl('circle', {
        cx: cx.toFixed(1), cy: y(pt.price).toFixed(1),
        r: '2.5', fill: color, opacity: '.72',
      }));
    });
    const midPt = sh.points[Math.floor(sh.points.length / 2)];
    const midX = xIndex(midPt.i);
    const tagY = y(midPt.price) + (sh.dir > 0 ? -7 : 12);
    if (midX >= PAD.l + 10 && midX <= xRight - 10 && tagY >= topBound + 6 && tagY <= botBound - 4) {
      const lab = svgEl('text', {
        x: midX.toFixed(1),
        y: tagY.toFixed(1),
        fill: color,
        'font-size': '9.5',
        'font-weight': '750',
        'font-family': 'var(--font)',
        'text-anchor': 'middle',
        stroke: 'var(--bg)',
        'stroke-width': '3',
        'paint-order': 'stroke',
        opacity: '.86',
      });
      lab.textContent = sh.name;
      gSh.appendChild(lab);
    }
    gRoot.appendChild(gSh);
  });

  // 2. 斜向形态支撑/压力趋势线与头肩颈线（严格按真实 barIndex 投影与裁剪，缩放平移零漂移）
  (pack.trendlines || []).forEach((tl) => {
    if (!tl || !bounds || !Number.isFinite(tl.slope) || !Number.isFinite(tl.intercept)) return;
    const i1 = Math.max(tl.startI, bounds.iLeft);
    const i2 = bounds.iRight;
    if (i1 >= i2) return;

    const asSup = tl.role === 'sup' || (tl.role === 'test' && (lastPx == null ? tl.structRole === 'sup' : lastPx >= tl.price));
    const color = asSup ? 'var(--up)' : 'var(--down)';
    const broken = tl.flipCount > 0;
    const x1 = xIndex(i1);
    const y1 = y(tl.intercept + tl.slope * i1);
    const y2 = y(tl.intercept + tl.slope * i2);
    if ((y1 < topBound - 40 && y2 < topBound - 40) || (y1 > botBound + 40 && y2 > botBound + 40)) return;

    const gTl = svgEl('g', { class: 'patsr-trendline', 'data-patsr-code': tl.code });
    const tip = svgEl('title', {});
    tip.textContent = tl.name + (broken ? '（已破位转换）' : '') + ' · 当前参考价 ' + px(tl.price) +
      ' · ' + tl.touches + ' 次触碰';
    gTl.appendChild(tip);

    gTl.appendChild(svgEl('line', {
      x1: x1.toFixed(1), x2: xRight.toFixed(1),
      y1: y1.toFixed(1), y2: y2.toFixed(1),
      stroke: color,
      'stroke-width': tl.role === 'test' ? '1.65' : '1.35',
      'stroke-dasharray': broken ? '5 4' : '7 3',
      opacity: broken ? '.52' : '.82',
    }));
    (tl.anchors || []).forEach((a) => {
      const ax = xIndex(a.i);
      if (ax < PAD.l - 1 || ax > xRight + 1) return;
      gTl.appendChild(svgEl('circle', {
        cx: ax.toFixed(1), cy: y(a.price).toFixed(1),
        r: '2.6', fill: 'var(--bg)', stroke: color, 'stroke-width': '1.35',
        opacity: broken ? '.6' : '.9',
      }));
    });
    if (y2 >= topBound - 6 && y2 <= botBound + 6) {
      const labY = placeLabelY(y2 - 4);
      const lab = svgEl('text', {
        x: (xRight - 4).toFixed(1),
        y: labY.toFixed(1),
        fill: color,
        'font-size': '10',
        'font-weight': '700',
        'font-family': 'var(--font)',
        'text-anchor': 'end',
        stroke: 'var(--bg)',
        'stroke-width': '3',
        'paint-order': 'stroke',
        opacity: broken ? '.65' : '.9',
      });
      const roleTag = broken ? ('转换' + (asSup ? '支撑' : '压力')) : '';
      lab.textContent = tl.name + (roleTag ? '·' + roleTag : '') + ' ' + px(tl.price);
      gTl.appendChild(lab);
    }
    gRoot.appendChild(gTl);
  });

  // 3. 水平形态支撑/压力带（含多形态共振与顶底转换）
  (pack.levels || []).forEach((lv) => {
    if (!lv || !Number.isFinite(lv.price)) return;
    const rawX1 = xIndex(lv.startI != null ? lv.startI : 0);
    if (rawX1 > xRight) return;
    const yy = y(lv.price);
    const yTop = y(lv.zoneHi != null ? lv.zoneHi : lv.price);
    const yBot = y(lv.zoneLo != null ? lv.zoneLo : lv.price);
    if (Math.max(yTop, yBot) < topBound - 6 || Math.min(yTop, yBot) > botBound + 6) return;

    const asSup = lv.role === 'sup' || (lv.role === 'test' && (lastPx == null ? lv.structRole === 'sup' : lastPx >= lv.price));
    const color = asSup ? 'var(--up)' : 'var(--down)';
    const isTest = lv.role === 'test';
    const broken = lv.flipCount > 0;
    const isConfluence = (lv.confluence || 1) >= 2;
    const x1 = Math.max(PAD.l, rawX1);
    const x2 = xRight;

    const gLv = svgEl('g', {
      class: 'patsr-level',
      'data-patsr-role': lv.role,
      'data-patsr-code': lv.code || '',
    });
    const tip = svgEl('title', {});
    tip.textContent = patSrTitle(lv, lastPx) +
      '\n区间: ' + px(lv.zoneLo) + ' – ' + px(lv.zoneHi) +
      '\n来源: ' + (lv.names ? lv.names.join(' + ') : lv.name) +
      '\n触碰: ' + lv.touches + ' 次 · 强度: ' + lv.strength +
      (broken ? (' · 顶底转换 ' + lv.flipCount + ' 次') : '');
    gLv.appendChild(tip);

    gLv.appendChild(svgEl('rect', {
      x: Math.min(x1, x2).toFixed(1),
      y: Math.min(yTop, yBot).toFixed(1),
      width: Math.max(2, Math.abs(x2 - x1)).toFixed(1),
      height: Math.max(2, Math.abs(yBot - yTop)).toFixed(1),
      fill: color,
      opacity: isTest ? '.15' : (isConfluence ? '.11' : (broken ? '.06' : '.085')),
    }));

    gLv.appendChild(svgEl('line', {
      x1: x1.toFixed(1), x2: x2.toFixed(1),
      y1: yy.toFixed(1), y2: yy.toFixed(1),
      stroke: color,
      'stroke-width': isTest ? '1.65' : (isConfluence ? '1.45' : '1.15'),
      'stroke-dasharray': broken ? '4 3' : (lv.isNeck ? '6 3' : ''),
      opacity: isTest ? '.92' : (broken ? '.56' : '.76'),
    }));

    const labY = placeLabelY(yy - 4);
    const lab = svgEl('text', {
      x: (x2 - 4).toFixed(1),
      y: labY.toFixed(1),
      fill: color,
      'font-size': isTest || isConfluence ? '10.5' : '10',
      'font-weight': isTest || isConfluence ? '750' : '650',
      'font-family': 'var(--font)',
      'text-anchor': 'end',
      stroke: 'var(--bg)',
      'stroke-width': '3',
      'paint-order': 'stroke',
      opacity: isTest ? '.96' : (broken ? '.72' : '.88'),
    });
    const touchTxt = lv.touches >= 2 ? (' · ' + lv.touches + '次') : '';
    const strTxt = lv.strength >= 76 ? ' · 强' : (lv.strength >= 56 ? ' · 中' : '');
    lab.textContent = patSrTitle(lv, lastPx) + touchTxt + strTxt;
    gLv.appendChild(lab);
    gRoot.appendChild(gLv);
  });

  svg.appendChild(gRoot);
}
