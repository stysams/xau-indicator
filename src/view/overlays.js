import { px } from '../core/format.js';
import { fibNear, fibRatioText } from '../indicators/fib.js';
import { svgEl } from './svg.js';

export function drawPbSetup(svg, pack, vx, y) {
  if (!pack || pack.hide || pack.status === 'none' || !pack.points || !pack.points.length) return;
  const color = pack.dir > 0 ? 'var(--up)' : 'var(--down)';
  const op = pack.status === 'trigger' ? '.95' : (pack.status === 'watch' ? '.82' : '.42');
  const dash = pack.status === 'trigger' ? '' : '5 4';
  let d = '';
  pack.points.forEach((pt, i) => {
    d += (i ? 'L' : 'M') + vx(pt.i).toFixed(1) + ',' + y(pt.price).toFixed(1);
  });
  svg.appendChild(svgEl('path', {
    d: d, fill: 'none', stroke: color,
    'stroke-width': pack.status === 'trigger' ? '1.8' : '1.4',
    'stroke-dasharray': dash, 'stroke-linejoin': 'round', opacity: op,
  }));
  pack.points.forEach((pt) => {
    svg.appendChild(svgEl('circle', {
      cx: vx(pt.i).toFixed(1), cy: y(pt.price).toFixed(1),
      r: '3.1', fill: color, opacity: op,
    }));
    const lowish = pt.lab === '低点' || pt.lab === '回踩' || pt.lab === '等待' || pt.lab === '杀起'
      || pt.lab === '诱空' || (pack.kind === 'trap' && pack.dir > 0 && pt.lab === '位');
    const t = svgEl('text', {
      x: vx(pt.i).toFixed(1),
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
    const x1 = vx(pack.recI >= 0 ? pack.recI : pack.extI);
    const lastPt = pack.points[pack.points.length - 1];
    const x2 = Math.max(x1 + 28, vx(lastPt.i));
    svg.appendChild(svgEl('line', {
      x1: x1.toFixed(1), x2: x2.toFixed(1),
      y1: y(pack.target).toFixed(1), y2: y(pack.target).toFixed(1),
      stroke: color, 'stroke-width': '1', 'stroke-dasharray': '2 3', opacity: '.7',
    }));
    const tg = svgEl('text', {
      x: (x2 - 4).toFixed(1),
      y: (y(pack.target) - 4).toFixed(1),
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

export function drawTrapSetup(svg, pack, vx, y, xRight) {
  if (!pack || pack.hide || pack.status === 'none' || pack.level == null) return;
  const color = pack.dir > 0 ? 'var(--up)' : 'var(--down)';
  const op = pack.status === 'trigger' ? '.95' : (pack.status === 'watch' ? '.82' : '.42');
  const dash = pack.status === 'trigger' ? '' : '5 4';
  const x1 = vx(pack.firstI >= 0 ? pack.firstI : pack.srcI);
  const x2 = xRight != null ? xRight : vx((pack.points[pack.points.length - 1] || {}).i || pack.sweepI);
  const yy = y(pack.level);
  if (pack.equal && pack.radius) {
    const top = y(pack.level + pack.radius);
    const bot = y(pack.level - pack.radius);
    svg.appendChild(svgEl('rect', {
      x: Math.min(x1, x2).toFixed(1),
      y: Math.min(top, bot).toFixed(1),
      width: Math.max(2, Math.abs(x2 - x1)).toFixed(1),
      height: Math.max(1.5, Math.abs(bot - top)).toFixed(1),
      fill: color,
      opacity: '.08',
    }));
  }
  svg.appendChild(svgEl('line', {
    x1: x1.toFixed(1), x2: x2.toFixed(1),
    y1: yy.toFixed(1), y2: yy.toFixed(1),
    stroke: color, 'stroke-width': pack.status === 'trigger' ? '1.5' : '1.2',
    'stroke-dasharray': dash, opacity: op,
  }));
  drawPbSetup(svg, pack, vx, y);
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

export function drawBox(svg, pack, vx, y, xRight) {
  if (!pack || !pack.ok || pack.top == null || pack.bottom == null) return;
  const broke = pack.status === 'breakUp' || pack.status === 'breakDn';
  const color = pack.status === 'breakUp'
    ? 'var(--up)'
    : (pack.status === 'breakDn' ? 'var(--down)' : 'var(--accent)');
  const x1 = vx(pack.boxStart >= 0 ? pack.boxStart : 0);
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
    const xc = vx(tc.i);
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
    // SVG 绘制只需要把索引映射到右边界；使用可见槽宽近似未来投影长度。
    const project = (line) => {
      const from = line.fromI;
      const to = line.toI;
      const slotPx = Math.max(1, Math.abs(vx(to) - vx(Math.max(from, to - 1))));
      const extraBars = Math.max(0, (xRight - vx(to)) / slotPx);
      return {
        x1: vx(from), x2: xRight,
        y1: y(line.intercept + line.slope * from),
        y2: y(line.intercept + line.slope * (to + extraBars)),
      };
    };
    [ext.upper, ext.lower].forEach((line) => {
      const q = project(line);
      extGroup.appendChild(svgEl('line', {
        x1: q.x1.toFixed(1), x2: q.x2.toFixed(1),
        y1: q.y1.toFixed(1), y2: q.y2.toFixed(1),
        stroke: extColor, 'stroke-width': '1.15', 'stroke-dasharray': '5 4',
      }));
      (line.anchors || []).forEach((a) => {
        extGroup.appendChild(svgEl('circle', {
          cx: vx(a.i).toFixed(1), cy: y(a.price).toFixed(1), r: '2', fill: extColor,
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
    g.appendChild(svgEl('line', {
      x1: vx(pack.breakI >= 0 ? pack.breakI : pack.boxStart).toFixed(1),
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

export function drawFib(svg, pack, vx, y, xRight, plotTop, plotBottom) {
  if (!pack || !pack.ok || !pack.levels || !pack.levels.length) return;
  const color = pack.dir > 0 ? 'var(--up)' : 'var(--down)';
  const gold = 'var(--warn)';
  const x1 = vx(Math.min(pack.start.i, pack.end.i));
  const x2 = xRight;
  const top = plotTop == null ? -20 : plotTop;
  const bot = plotBottom == null ? 1e9 : plotBottom;
  const opBase = pack.status === 'trigger' ? .95 : (pack.status === 'watch' ? .84 : .7);
  svg.appendChild(svgEl('line', {
    x1: vx(pack.start.i).toFixed(1), x2: vx(pack.end.i).toFixed(1),
    y1: y(pack.start.price).toFixed(1), y2: y(pack.end.price).toFixed(1),
    stroke: 'var(--accent)', 'stroke-width': '1.15',
    'stroke-dasharray': '4 4', opacity: '.55',
  }));
  pack.points.forEach((pt) => {
    svg.appendChild(svgEl('circle', {
      cx: vx(pt.i).toFixed(1), cy: y(pt.price).toFixed(1),
      r: '2.8', fill: 'var(--accent)', opacity: '.85',
    }));
    const t = svgEl('text', {
      x: vx(pt.i).toFixed(1),
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
