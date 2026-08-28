import { fmtAxis, fmtBarTime, px } from '../core/format.js';
import { rsi } from '../core/math.js';
import { getBollMacd } from '../indicators/boll.js';
import { getBox } from '../indicators/box.js';
import { fibRatioText, getFib } from '../indicators/fib.js';
import { getHkld } from '../indicators/hkld.js';
import { getHold } from '../indicators/hold.js';
import { getHs, hsNeckAt } from '../indicators/hs.js';
import { getPb } from '../indicators/pb.js';
import { getSmc } from '../indicators/smc.js';
import { getSr, srTitle } from '../indicators/sr.js';
import { getStack, stackMarkIndex } from '../indicators/stack.js';
import { getSuperTrend } from '../indicators/supertrend.js';
import { getTrap } from '../indicators/trap.js';
import { $, H, PAD, W, state } from '../state.js';
import { simOpenOrders } from '../trade/sim.js';
import { bollDash, bollSt } from '../ui/indicator-menu.js';
import { drawOscPanes, findPane, oscLayout, paneY } from './osc.js';
import { drawBox, drawFib, drawHkld, drawHold, drawPbSetup, drawTrapSetup } from './overlays.js';
import { drawSignalRail } from './signal-rail.js';
import { bollAreaD, lineD, lineSegD, svgEl } from './svg.js';
import { drawFastOverlay, drawSimOverlay, openFastTrade, placeFastTags } from './trade-overlay.js';
import { chartSlice, updateZoomLabel } from './viewport.js';

export function drawChart(klines, ticker, hover) {
  const svg = $('chart');
  svg.replaceChildren();
  $('chartEmpty').style.display = klines.length ? 'none' : 'grid';
  if (!klines.length) {
    hideCrosshair();
    placeLastTag(null);
    placeFastTags();
    return;
  }

  const view = chartSlice(klines);
  const vis = view.bars;
  const e9 = view.e9;
  const e21 = view.e21;
  const smcPack = (state.ind.smc || state.ind.smcSig) ? getSmc(klines) : null;
  const smc = state.ind.smc ? smcPack : null;
  const hs = state.ind.hs ? getHs(klines) : null;
  const sr = state.ind.sr ? getSr(klines) : null;
  const pbPack = (state.ind.bounce || state.ind.pull) ? getPb(klines) : null;
  const bounce = (state.ind.bounce && pbPack) ? pbPack.bounce : null;
  const pull = (state.ind.pull && pbPack) ? pbPack.pull : null;
  const trap = state.ind.trap ? getTrap(klines) : null;
  const hold = state.ind.hold ? getHold(klines) : null;
  const hkld = state.ind.hkld ? getHkld(klines) : null;
  const fib = state.ind.fib ? getFib(klines) : null;
  const stPack = state.ind.st ? getSuperTrend(klines) : null;
  const box = state.ind.box ? getBox(klines) : null;
  let lo = Infinity, hi = -Infinity;
  vis.forEach((k) => { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); });
  if (state.ind.ema9) {
    e9.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  }
  if (state.ind.ema21) {
    e21.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  }
  if (state.ind.boll) {
    const addBand = (up, dn) => {
      up.concat(dn).forEach((v) => {
        if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      });
    };
    if (state.ind.boll2) addBand(view.bollUp, view.bollDn);
    if (state.ind.boll1) addBand(view.boll1Up, view.boll1Dn);
    if (state.ind.boll3) addBand(view.boll3Up, view.boll3Dn);
    view.bollMid.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  }
  const fastTr = openFastTrade();
  if (state.ind.fast && fastTr) {
    [fastTr.entry, fastTr.tp, fastTr.sl].forEach((v) => {
      if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    });
  }
  simOpenOrders().forEach((o) => {
    if (o.entry != null) { lo = Math.min(lo, o.entry); hi = Math.max(hi, o.entry); }
  });
  if (hs && hs.patterns) {
    hs.patterns.forEach((p) => {
      [p.ls, p.t1, p.head, p.t2, p.rs].forEach((pt) => {
        if (pt && pt.price != null) { lo = Math.min(lo, pt.price); hi = Math.max(hi, pt.price); }
      });
      if (p.status === 'confirmed' && p.target != null) {
        lo = Math.min(lo, p.target);
        hi = Math.max(hi, p.target);
      }
    });
  }
  if (sr) {
    const lastPx = vis[vis.length - 1] && vis[vis.length - 1].c;
    const span = (hi - lo) || 1;
    const cap = Math.max((sr.atrv || 0) * 1.8, span * 0.16);
    const allow = (p) => p != null && lastPx != null && Math.abs(p - lastPx) <= cap;
    if (sr.nearSup && allow(sr.nearSup.price)) lo = Math.min(lo, sr.nearSup.price);
    if (sr.nearRes && allow(sr.nearRes.price)) hi = Math.max(hi, sr.nearRes.price);
    if (sr.nearTest && allow(sr.nearTest.price)) {
      lo = Math.min(lo, sr.nearTest.price);
      hi = Math.max(hi, sr.nearTest.price);
    }
  }
  function pbExpand(pack) {
    if (!pack || pack.status === 'none') return;
    (pack.points || []).forEach((pt) => {
      if (pt && pt.price != null) { lo = Math.min(lo, pt.price); hi = Math.max(hi, pt.price); }
    });
    if (pack.status === 'trigger' && pack.target != null) {
      lo = Math.min(lo, pack.target);
      hi = Math.max(hi, pack.target);
    }
  }
  pbExpand(bounce);
  pbExpand(pull);
  if (trap && trap.status !== 'none') {
    if (trap.level != null) {
      lo = Math.min(lo, trap.level);
      hi = Math.max(hi, trap.level);
    }
    if (trap.sweepPx != null) {
      lo = Math.min(lo, trap.sweepPx);
      hi = Math.max(hi, trap.sweepPx);
    }
    pbExpand(trap);
  }
  if (hold && hold.ok) {
    (hold.marks || []).forEach((mk) => {
      if (mk.price != null) {
        lo = Math.min(lo, mk.price, mk.tap != null ? mk.tap : mk.price);
        hi = Math.max(hi, mk.price, mk.tap != null ? mk.tap : mk.price);
      }
    });
  }
  if (hkld && hkld.ok) {
    if (hkld.longPx != null) {
      lo = Math.min(lo, hkld.longLo != null ? hkld.longLo : hkld.longPx, hkld.longPx);
      hi = Math.max(hi, hkld.longHi != null ? hkld.longHi : hkld.longPx, hkld.longPx);
    }
    if (hkld.shortPx != null) {
      lo = Math.min(lo, hkld.shortLo != null ? hkld.shortLo : hkld.shortPx, hkld.shortPx);
      hi = Math.max(hi, hkld.shortHi != null ? hkld.shortHi : hkld.shortPx, hkld.shortPx);
    }
    if (hkld.breakLevel != null) {
      lo = Math.min(lo, hkld.breakLevel);
      hi = Math.max(hi, hkld.breakLevel);
    }
  }
  if (fib && fib.ok) {
    const lastVis = vis[vis.length - 1] && vis[vis.length - 1].c;
    const span = (hi - lo) || 1;
    const cap = Math.max((fib.atrv || 0) * 2.2, span * 0.22);
    (fib.levels || []).forEach((lv) => {
      if (lv.ext) return;
      if (lastVis == null || Math.abs(lv.price - lastVis) > cap) return;
      lo = Math.min(lo, lv.price);
      hi = Math.max(hi, lv.price);
    });
  }
  if (stPack && stPack.ok) {
    const a = Math.max(0, view.start);
    const b = Math.min(klines.length, view.end);
    for (let i = a; i < b; i++) {
      const v = stPack.st[i];
      if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  if (box && box.ok) {
    lo = Math.min(lo, box.bottom);
    hi = Math.max(hi, box.top);
    if (box.target != null && Number.isFinite(box.target)) {
      lo = Math.min(lo, box.target);
      hi = Math.max(hi, box.target);
    }
    const ext = box.extension;
    if (ext && ext.upper && ext.lower) {
      const plotW0 = W - PAD.l - PAD.r;
      const slots0 = Math.max(1, view.count);
      const slot0 = plotW0 / slots0;
      const rightX0 = W - PAD.r;
      const projected = (line) => {
        const xAt = PAD.l + (line.toI - view.start + 0.5) * slot0;
        const extra = Math.max(0, (rightX0 - xAt) / Math.max(1, slot0));
        return line.intercept + line.slope * (line.toI + extra);
      };
      [ext.upper, ext.lower].forEach((line) => {
        const end = projected(line);
        if (Number.isFinite(end)) {
          lo = Math.min(lo, end);
          hi = Math.max(hi, end);
        }
      });
    }
  }
  const padY = (hi - lo) * 0.08 || 1;
  lo -= padY; hi += padY;
  const plotW = W - PAD.l - PAD.r;
  const osc = oscLayout();
  const plotH = osc.plotH;
  const plotBottom = osc.plotBottom;
  const nBars = vis.length;
  const lastPx = nBars ? vis[nBars - 1].c : null;
  const slots = Math.max(1, view.count);
  const slot = plotW / slots;
  const bodyW = Math.max(0.7, Math.min(slot * 0.82, Math.max(0.4, slot - 0.35)));
  const wickW = bodyW < 1.7
    ? Math.max(0.55, bodyW * 0.9)
    : Math.min(2.1, Math.max(0.85, bodyW * 0.08));
  const bodyStroke = bodyW < 2.2
    ? Math.max(0.35, Math.min(0.95, bodyW * 0.22))
    : Math.min(1.4, Math.max(0.7, bodyW * 0.05));
  const hollowUp = bodyW >= 2.2;
  const i0 = Math.max(0, view.start);
  const xSlot = (si) => PAD.l + (si + 0.5) * slot;
  const x = (i) => xSlot(i + (i0 - view.start));
  const y = (v) => PAD.t + (hi - v) / (hi - lo) * plotH;
  const vx = (i) => {
    const si = i - view.start;
    if (si < 0) return PAD.l;
    if (si >= slots) return W - PAD.r;
    return xSlot(si);
  };
  const lastY = (state.ind.last && lastPx != null) ? y(lastPx) : null;

  const gGrid = svgEl('g', { opacity: '.55' });
  for (let i = 0; i < 5; i++) {
    const v = lo + (hi - lo) * i / 4;
    const yy = y(v);
    gGrid.appendChild(svgEl('line', {
      x1: PAD.l, x2: W - PAD.r, y1: yy, y2: yy,
      stroke: 'rgba(15,35,34,.10)', 'stroke-width': '1',
    }));
    if (lastY != null && Math.abs(yy - lastY) < 13) continue;
    const t = svgEl('text', {
      x: W - PAD.r + 6, y: yy + 4,
      fill: 'var(--ink-3)', 'font-size': '11', 'font-family': 'var(--font-mono)',
    });
    t.textContent = v.toFixed(2);
    gGrid.appendChild(t);
  }
  svg.appendChild(gGrid);

  if (state.ind.boll) {
    function polyB(arr, stroke, dash, id, width, op) {
      const d = lineD(arr, x, y);
      if (!d) return;
      const attrs = {
        d: d, fill: 'none', stroke: stroke, 'stroke-width': width || '1.2',
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      };
      if (dash) attrs['stroke-dasharray'] = dash;
      if (op) attrs.opacity = op;
      const path = svgEl('path', attrs);
      path.setAttribute('id', id);
      svg.appendChild(path);
    }
    function fillB(up, dn, color, id) {
      if (!color) return;
      const area = bollAreaD(up, dn, x, y);
      if (!area) return;
      const p = svgEl('path', {
        d: area, fill: color, stroke: 'none', 'fill-opacity': '.16',
      });
      p.setAttribute('id', id);
      svg.appendChild(p);
    }
    const s1 = bollSt(1);
    const s2 = bollSt(2);
    const s3 = bollSt(3);
    if (state.ind.boll3 && s3.fillOn) fillB(view.boll3Up, view.boll3Dn, s3.fill, 'ck-boll3-fill');
    if (state.ind.boll2 && s2.fillOn) fillB(view.bollUp, view.bollDn, s2.fill, 'ck-boll-fill');
    if (state.ind.boll1 && s1.fillOn) fillB(view.boll1Up, view.boll1Dn, s1.fill, 'ck-boll1-fill');
    if (state.ind.boll3) {
      polyB(view.boll3Up, s3.line, bollDash(3), 'ck-boll3-up', '1');
      polyB(view.boll3Dn, s3.line, bollDash(3), 'ck-boll3-dn', '1');
    }
    if (state.ind.boll2) {
      polyB(view.bollUp, s2.line, bollDash(2), 'ck-boll-up', '1.2');
      polyB(view.bollDn, s2.line, bollDash(2), 'ck-boll-dn', '1.2');
    }
    polyB(view.bollMid, s2.line, '', 'ck-boll-mid', '1.4');
    if (state.ind.boll1) {
      polyB(view.boll1Up, s1.line, bollDash(1), 'ck-boll1-up', '1');
      polyB(view.boll1Dn, s1.line, bollDash(1), 'ck-boll1-dn', '1');
    }
  }

  if (smc) {
    const gFvg = svgEl('g', { opacity: '.28' });
    smc.fvgs.forEach((g) => {
      const x1 = vx(g.i0);
      const x2 = vx(g.end);
      const top = y(g.top);
      const bot = y(g.bot);
      gFvg.appendChild(svgEl('rect', {
        x: Math.min(x1, x2),
        y: Math.min(top, bot),
        width: Math.max(2, Math.abs(x2 - x1)),
        height: Math.max(1.5, Math.abs(bot - top)),
        fill: g.dir > 0 ? 'var(--up)' : 'var(--down)',
      }));
    });
    svg.appendChild(gFvg);
    const gOb = svgEl('g', { opacity: '.22' });
    smc.obs.forEach((ob) => {
      const x1 = vx(ob.i) - bodyW / 2;
      const x2 = vx(ob.end);
      const top = y(ob.top);
      const bot = y(ob.bot);
      gOb.appendChild(svgEl('rect', {
        x: Math.min(x1, x2),
        y: Math.min(top, bot),
        width: Math.max(2, Math.abs(x2 - x1)),
        height: Math.max(1.5, Math.abs(bot - top)),
        fill: ob.dir > 0 ? 'var(--up)' : 'var(--down)',
        stroke: ob.dir > 0 ? 'var(--up)' : 'var(--down)',
        'stroke-width': '1',
        opacity: '.95',
      }));
    });
    svg.appendChild(gOb);
  }

  if (box && box.ok) {
    drawBox(svg, box, vx, y, W - PAD.r);
  }

  if (state.ind.hl && ticker && ticker.high && ticker.low) {
    [ticker.high, ticker.low].forEach((lv, idx) => {
      if (lv < lo || lv > hi) return;
      svg.appendChild(svgEl('line', {
        x1: PAD.l, x2: W - PAD.r, y1: y(lv), y2: y(lv),
        stroke: idx ? 'var(--down)' : 'var(--up)',
        'stroke-width': '1', 'stroke-dasharray': '3 4', opacity: '.45',
      }));
    });
  }

  const gC = svgEl('g', {});
  vis.forEach((k, i) => {
    const xc = x(i);
    const up = k.c >= k.o;
    const color = up ? 'var(--up)' : 'var(--down)';
    const isLast = view.follow && i === nBars - 1;
    const wick = svgEl('line', {
      x1: xc, x2: xc, y1: y(k.h), y2: y(k.l),
      stroke: color, 'stroke-width': String(wickW),
    });
    if (isLast) wick.setAttribute('id', 'ck-wick');
    gC.appendChild(wick);
    const top = y(Math.max(k.o, k.c));
    const bot = y(Math.min(k.o, k.c));
    const bh = Math.max(Math.min(1.2, bodyW), bot - top);
    const body = svgEl('rect', {
      x: xc - bodyW / 2, y: top, width: bodyW, height: bh,
      fill: (up && hollowUp) ? 'var(--bg)' : color,
      stroke: color, 'stroke-width': String(bodyStroke),
    });
    if (isLast) body.setAttribute('id', 'ck-body');
    gC.appendChild(body);
  });
  svg.appendChild(gC);

  function poly(arr, stroke, dash, id) {
    const d = lineD(arr, x, y);
    if (!d) return;
    const path = svgEl('path', {
      d: d, fill: 'none', stroke: stroke, 'stroke-width': '1.6',
      'stroke-dasharray': dash || '', 'stroke-linejoin': 'round',
    });
    if (id) path.setAttribute('id', id);
    svg.appendChild(path);
  }
  if (state.ind.ema9) poly(e9, 'var(--accent)', '', 'ck-ema9');
  if (state.ind.ema21) poly(e21, 'var(--accent-2)', '4 3', 'ck-ema21');

  if (stPack && stPack.ok) {
    const stUpVis = stPack.up.slice(i0, i0 + nBars);
    const stDnVis = stPack.dn.slice(i0, i0 + nBars);
    function stLine(arr, stroke, id) {
      const d = lineSegD(arr, x, y);
      if (!d) return;
      const path = svgEl('path', {
        d: d, fill: 'none', stroke: stroke, 'stroke-width': '1.75',
        'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: '.92',
      });
      path.setAttribute('id', id);
      svg.appendChild(path);
    }
    stLine(stUpVis, 'var(--up)', 'ck-st-up');
    stLine(stDnVis, 'var(--down)', 'ck-st-dn');
    (stPack.flips || []).forEach((fl) => {
      if (fl.i < view.start || fl.i > view.end) return;
      const xc = vx(fl.i);
      const yy = y(fl.price);
      const upFlip = fl.dir > 0;
      const color = upFlip ? 'var(--up)' : 'var(--down)';
      const gFl = svgEl('g', {});
      const tip = svgEl('title', {});
      tip.textContent = (upFlip ? '超级趋势转多 ' : '超级趋势转空 ') + px(fl.price);
      gFl.appendChild(tip);
      gFl.appendChild(svgEl('polygon', {
        points: upFlip
          ? xc.toFixed(1) + ',' + (yy - 8.5).toFixed(1) + ' ' + (xc - 5.5).toFixed(1) + ',' + (yy + 2).toFixed(1) + ' ' + (xc + 5.5).toFixed(1) + ',' + (yy + 2).toFixed(1)
          : xc.toFixed(1) + ',' + (yy + 8.5).toFixed(1) + ' ' + (xc - 5.5).toFixed(1) + ',' + (yy - 2).toFixed(1) + ' ' + (xc + 5.5).toFixed(1) + ',' + (yy - 2).toFixed(1),
        fill: color,
        opacity: '.92',
      }));
      const lab = svgEl('text', {
        x: xc.toFixed(1),
        y: (upFlip ? yy + 14 : yy - 11).toFixed(1),
        fill: color,
        'font-size': '10.5',
        'font-weight': '750',
        'font-family': 'var(--font)',
        'text-anchor': 'middle',
        stroke: 'var(--bg)',
        'stroke-width': '3',
        'paint-order': 'stroke',
        opacity: '.92',
      });
      lab.textContent = upFlip ? '转多' : '转空';
      gFl.appendChild(lab);
      svg.appendChild(gFl);
    });
  }

  if (smc) {
    const gEv = svgEl('g', {});
    smc.events.forEach((ev) => {
      if (ev.i < view.start - 2 || ev.from > view.end) return;
      const yy = y(ev.price);
      gEv.appendChild(svgEl('line', {
        x1: vx(ev.from), x2: vx(ev.i), y1: yy, y2: yy,
        stroke: ev.dir > 0 ? 'var(--up)' : 'var(--down)',
        'stroke-width': '1', 'stroke-dasharray': '4 3', opacity: '.7',
      }));
      const lab = svgEl('text', {
        x: vx(ev.i) + 4, y: yy - 3,
        fill: ev.dir > 0 ? 'var(--up)' : 'var(--down)',
        'font-size': '10', 'font-weight': '700',
        'font-family': 'var(--font)',
      });
      lab.textContent = ev.kind;
      gEv.appendChild(lab);
    });
    svg.appendChild(gEv);
  }
  if (state.ind.smcSig && smcPack) {
    const gSig = svgEl('g', {});
    (smcPack.signals || []).forEach((sig) => {
      if (sig.i < view.start - 1 || sig.i > view.end + 1) return;
      const bar = klines[sig.i];
      if (!bar) return;
      const xc = vx(sig.i);
      const upMk = sig.dir > 0;
      const op = sig.status === 'trigger' ? '.95' : (sig.status === 'watch' ? '.78' : '.42');
      const color = upMk ? 'var(--up)' : 'var(--down)';
      let yy = upMk ? y(bar.l) + 16 : y(bar.h) - 16;
      yy = Math.max(PAD.t + 14, Math.min(plotBottom - 18, yy));
      const gOne = svgEl('g', {});
      const tip = svgEl('title', {});
      tip.textContent = sig.why || sig.title;
      gOne.appendChild(tip);
      gOne.appendChild(svgEl('polygon', {
        points: upMk
          ? xc.toFixed(1) + ',' + (yy - 8).toFixed(1) + ' ' + (xc - 6.5).toFixed(1) + ',' + (yy + 4).toFixed(1) + ' ' + (xc + 6.5).toFixed(1) + ',' + (yy + 4).toFixed(1)
          : xc.toFixed(1) + ',' + (yy + 8).toFixed(1) + ' ' + (xc - 6.5).toFixed(1) + ',' + (yy - 4).toFixed(1) + ' ' + (xc + 6.5).toFixed(1) + ',' + (yy - 4).toFixed(1),
        fill: color,
        opacity: op,
      }));
      const lab = svgEl('text', {
        x: xc.toFixed(1),
        y: (upMk ? yy + 16 : yy - 10).toFixed(1),
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
      lab.textContent = sig.label || (upMk ? '做多' : '做空');
      gOne.appendChild(lab);
      gSig.appendChild(gOne);
    });
    svg.appendChild(gSig);
  }
  if (state.ind.stack) {
    const st = getStack();
    if (st && st.dir && (st.status === 'trigger' || st.status === 'watch')) {
      const ti = stackMarkIndex(klines, st.t);
      if (ti >= view.start - 1 && ti <= view.end + 1 && klines[ti]) {
        const bar = klines[ti];
        const xc = vx(ti) + 8;
        const upMk = st.dir > 0;
        const op = st.status === 'trigger' ? '.95' : '.72';
        const color = upMk ? 'var(--up)' : 'var(--down)';
        let yy = upMk ? y(bar.l) + 28 : y(bar.h) - 28;
        yy = Math.max(PAD.t + 16, Math.min(plotBottom - 20, yy));
        const gSt = svgEl('g', {});
        const tip = svgEl('title', {});
        tip.textContent = st.why || st.title;
        gSt.appendChild(tip);
        gSt.appendChild(svgEl('polygon', {
          points: xc.toFixed(1) + ',' + (yy - 7).toFixed(1) + ' ' +
            (xc + 6).toFixed(1) + ',' + yy.toFixed(1) + ' ' +
            xc.toFixed(1) + ',' + (yy + 7).toFixed(1) + ' ' +
            (xc - 6).toFixed(1) + ',' + yy.toFixed(1),
          fill: st.status === 'watch' ? 'none' : color,
          stroke: color,
          'stroke-width': '1.6',
          opacity: op,
        }));
        const lab = svgEl('text', {
          x: xc.toFixed(1),
          y: (upMk ? yy + 18 : yy - 12).toFixed(1),
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
        lab.textContent = st.label || '套轨';
        gSt.appendChild(lab);
        svg.appendChild(gSt);
      }
    }
  }
  const smcLab = $('smcLab');
  if (smcLab) {
    if (state.ind.smcSig && smcPack && smcPack.live) smcLab.textContent = smcPack.live.title || '';
    else if (smc) smcLab.textContent = smc.label || '';
    else smcLab.textContent = '';
  }

  const hsLab = $('hsLab');
  if (hs && hs.patterns && hs.patterns.length) {
    if (hsLab) hsLab.textContent = hs.label || '';
    hs.patterns.forEach((p) => {
      const color = p.status === 'failed'
        ? 'var(--ink-3)'
        : (p.kind === 'top' ? 'var(--down)' : 'var(--up)');
      const op = p.status === 'failed' ? '.42' : (p.status === 'forming' ? '.82' : '.95');
      const pts = [p.ls, p.t1, p.head, p.t2, p.rs];
      let d = '';
      pts.forEach((pt, idx) => {
        d += (idx ? 'L' : 'M') + vx(pt.i).toFixed(1) + ',' + y(pt.price).toFixed(1);
      });
      svg.appendChild(svgEl('path', {
        d: d, fill: 'none', stroke: color,
        'stroke-width': p.status === 'confirmed' ? '1.8' : '1.45',
        'stroke-dasharray': p.status === 'forming' ? '5 4' : '',
        'stroke-linejoin': 'round',
        opacity: op,
      }));
      pts.forEach((pt) => {
        svg.appendChild(svgEl('circle', {
          cx: vx(pt.i).toFixed(1),
          cy: y(pt.price).toFixed(1),
          r: '3.1',
          fill: color,
          opacity: op,
        }));
      });
      const extI = p.breakI != null
        ? p.breakI
        : Math.max(p.rs.i, view.start + Math.max(0, vis.length - 1), klines.length - 1);
      const nx1 = vx(p.t1.i);
      const nx2 = vx(extI);
      const ny1 = y(hsNeckAt(p.t1, p.t2, p.t1.i));
      const ny2 = y(hsNeckAt(p.t1, p.t2, extI));
      svg.appendChild(svgEl('line', {
        x1: nx1.toFixed(1), x2: nx2.toFixed(1),
        y1: ny1.toFixed(1), y2: ny2.toFixed(1),
        stroke: color, 'stroke-width': '1.25',
        'stroke-dasharray': '6 4', opacity: String(Math.max(0.5, Number(op))),
      }));
      if (p.status === 'confirmed' && p.target != null) {
        svg.appendChild(svgEl('line', {
          x1: vx(p.breakI != null ? p.breakI : p.rs.i).toFixed(1),
          x2: vx(extI).toFixed(1),
          y1: y(p.target).toFixed(1),
          y2: y(p.target).toFixed(1),
          stroke: color, 'stroke-width': '1',
          'stroke-dasharray': '2 3', opacity: '.7',
        }));
      }
      const yOff = (pt, isHead) => {
        const above = p.kind === 'top';
        const extra = isHead ? 12 : 9;
        return above ? -extra : extra + 3;
      };
      function hsText(txt, pt, isHead) {
        const t = svgEl('text', {
          x: vx(pt.i).toFixed(1),
          y: (y(pt.price) + yOff(pt, isHead)).toFixed(1),
          fill: color,
          'font-size': isHead ? '10.5' : '10',
          'font-weight': '700',
          'font-family': 'var(--font)',
          'text-anchor': 'middle',
          stroke: 'var(--bg)',
          'stroke-width': '3',
          'paint-order': 'stroke',
          opacity: op,
        });
        t.textContent = txt;
        svg.appendChild(t);
      }
      hsText('左肩', p.ls, false);
      hsText('头', p.head, true);
      hsText(p.liveRs ? '右肩?' : '右肩', p.rs, false);
      const midI = Math.round((p.t1.i + (p.breakI != null ? p.breakI : p.t2.i)) / 2);
      const neckLab = svgEl('text', {
        x: vx(midI).toFixed(1),
        y: (y(hsNeckAt(p.t1, p.t2, midI)) + (p.kind === 'top' ? 12 : -6)).toFixed(1),
        fill: color,
        'font-size': '10',
        'font-weight': '650',
        'font-family': 'var(--font)',
        'text-anchor': 'middle',
        stroke: 'var(--bg)',
        'stroke-width': '3',
        'paint-order': 'stroke',
        opacity: op,
      });
      neckLab.textContent = p.status === 'confirmed' ? '颈线已破' : '颈线';
      svg.appendChild(neckLab);
      if (p.status === 'confirmed' && p.target != null) {
        const tg = svgEl('text', {
          x: (vx(extI) - 4).toFixed(1),
          y: (y(p.target) - 4).toFixed(1),
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
        tg.textContent = p.targetHit ? '量度已到' : '量度';
        svg.appendChild(tg);
      }
    });
  } else if (hsLab) {
    hsLab.textContent = state.ind.hs ? '头肩未现' : '';
  }

  const srLab = $('srLab');
  if (sr && sr.levels && sr.levels.length) {
    if (srLab) srLab.textContent = sr.label || '';
    const lastPx = vis[nBars - 1] && vis[nBars - 1].c;
    const usedY = [];
    if (lastY != null) usedY.push(lastY - 4);
    sr.levels.forEach((lv) => {
      if (lv.price < lo || lv.price > hi) return;
      const asSup = lastPx == null ? lv.role === 'sup' : lastPx >= lv.price;
      const color = lv.role === 'res' || (lv.role === 'test' && !asSup) ? 'var(--sr-res)' : 'var(--sr-sup)';
      const broken = lv.breakI != null;
      const isTest = lv.role === 'test';
      const op = isTest ? '.62' : (broken ? '.32' : (lv.touches >= 3 ? '.5' : '.38'));
      const labOp = isTest ? '.8' : (broken ? '.42' : (lv.touches >= 3 ? '.66' : '.52'));
      const isBoll20 = lv.source === 'boll20' || lv.boll20;
      const dash = broken ? '4 4' : (lv.source === 'round' || lv.session ? '6 4' : (isBoll20 ? '2 3' : ''));
      const width = isTest ? '1.5' : (lv.touches >= 3 ? '1.3' : '1.05');
      const yy = y(lv.price);
      const x1 = vx(lv.firstI);
      const x2 = W - PAD.r;
      if ((lv.role === 'test' || isBoll20) && sr.radius) {
        const zone = isBoll20 && lv.spread ? Math.max(sr.radius * 0.7, lv.spread * 0.5) : sr.radius;
        const top = y(lv.price + zone);
        const bot = y(lv.price - zone);
        svg.appendChild(svgEl('rect', {
          x: Math.min(x1, x2).toFixed(1),
          y: Math.min(top, bot).toFixed(1),
          width: Math.max(2, Math.abs(x2 - x1)).toFixed(1),
          height: Math.max(1.5, Math.abs(bot - top)).toFixed(1),
          fill: color,
          opacity: isBoll20 ? '.05' : '.07',
        }));
      }
      svg.appendChild(svgEl('line', {
        x1: x1.toFixed(1), x2: x2.toFixed(1),
        y1: yy.toFixed(1), y2: yy.toFixed(1),
        stroke: color, 'stroke-width': width,
        'stroke-dasharray': dash, opacity: op,
      }));
      const weakRound = lv.source === 'round' && lv.touches < 2;
      if (weakRound) return;
      let labY = yy - 4;
      usedY.forEach((uy) => {
        if (Math.abs(uy - labY) < 12) labY = uy - 12;
      });
      usedY.push(labY);
      const lab = svgEl('text', {
        x: (x2 - 4).toFixed(1),
        y: labY.toFixed(1),
        fill: color,
        'font-size': '10',
        'font-weight': '650',
        'font-family': 'var(--font)',
        'text-anchor': 'end',
        stroke: 'var(--bg)',
        'stroke-width': '3',
        'paint-order': 'stroke',
        opacity: labOp,
      });
      const touchTxt = lv.touches >= 2 ? ' · ' + lv.touches + '次' : '';
      const strengthTxt = lv.strength >= 70 ? ' · 强' : (lv.strength >= 50 ? ' · 中' : ' · 弱');
      lab.textContent = srTitle(lv, lastPx) + touchTxt + strengthTxt;
      svg.appendChild(lab);
    });
  } else if (srLab) {
    srLab.textContent = state.ind.sr ? '支压未现' : '';
  }

  const bounceLab = $('bounceLab');
  if (bounce && bounce.status !== 'none' && !bounce.hide) {
    if (bounceLab) bounceLab.textContent = bounce.label || '';
    drawPbSetup(svg, bounce, vx, y);
  } else if (bounceLab) {
    bounceLab.textContent = state.ind.bounce ? '超跌反弹未现' : '';
  }
  const pullLab = $('pullLab');
  if (pull && pull.status !== 'none' && !pull.hide) {
    if (pullLab) pullLab.textContent = pull.label || '';
    drawPbSetup(svg, pull, vx, y);
  } else if (pullLab) {
    pullLab.textContent = state.ind.pull ? '拉升回踩未现' : '';
  }
  const trapLab = $('trapLab');
  if (trap && trap.status !== 'none' && !trap.hide) {
    if (trapLab) trapLab.textContent = trap.label || '';
    drawTrapSetup(svg, trap, vx, y, W - PAD.r);
  } else if (trapLab) {
    trapLab.textContent = state.ind.trap ? '诱空诱多未现' : '';
  }
  if (hold && hold.ok) {
    drawHold(svg, hold, vx, y, W - PAD.r, bodyW);
  }
  if (hkld && hkld.ok) {
    drawHkld(svg, hkld, vx, y, W - PAD.r);
  }
  if (fib && fib.ok) {
    drawFib(svg, fib, vx, y, W - PAD.r, PAD.t, plotBottom);
  }

  if (state.ind.macd) {
    const pack = getBollMacd(klines);
    const marks = (pack.sig && pack.sig.marks) || [];
    marks.forEach((mk) => {
      const visI = mk.i - i0;
      if (visI < 0 || visI >= nBars) return;
      const bar = vis[visI];
      const xc = x(visI);
      const upMk = mk.vote > 0;
      const yy = upMk ? y(bar.l) + 8 : y(bar.h) - 8;
      const tri = svgEl('polygon', {
        points: upMk
          ? xc.toFixed(1) + ',' + (yy - 6).toFixed(1) + ' ' + (xc - 5).toFixed(1) + ',' + (yy + 4).toFixed(1) + ' ' + (xc + 5).toFixed(1) + ',' + (yy + 4).toFixed(1)
          : xc.toFixed(1) + ',' + (yy + 6).toFixed(1) + ' ' + (xc - 5).toFixed(1) + ',' + (yy - 4).toFixed(1) + ' ' + (xc + 5).toFixed(1) + ',' + (yy - 4).toFixed(1),
        fill: upMk ? 'var(--up)' : 'var(--down)',
        opacity: '.9',
      });
      svg.appendChild(tri);
    });
  }

  drawOscPanes(svg, view, osc.panes, x, nBars, bodyW);

  state.chartScale = {
    lo: lo, hi: hi, nBars: nBars, lastT: vis[nBars - 1].t, x: x, y: y,
    start: view.start, follow: view.follow, fullN: klines.length,
    plotTop: PAD.t, plotBottom: plotBottom, lastPx: lastPx,
    panes: osc.panes.map((p) => ({
      key: p.key, top: p.top, h: p.h, lo: p.lo, hi: p.hi, digits: p.digits,
    })),
    bodyW: bodyW, wickW: wickW, bodyStroke: bodyStroke, hollowUp: hollowUp,
    boxSig: box ? box.sig : '', stDir: stPack ? stPack.lastDir : 0,
  };
  drawFastOverlay(svg, vis, view, x, y);
  drawSimOverlay(svg, y);
  if (state.ind.last && lastPx != null) {
    const lastLine = svgEl('line', {
      x1: PAD.l, x2: W - PAD.r, y1: y(lastPx), y2: y(lastPx),
      stroke: 'var(--ink-1)', 'stroke-width': '1.15', 'stroke-dasharray': '2 3', opacity: '.7',
    });
    lastLine.setAttribute('id', 'ck-last');
    svg.appendChild(lastLine);
  }
  refreshCrosshair();
  placeLastTag(lastPx);
  placeFastTags();

  const wrapW = ($('chartWrap') && $('chartWrap').clientWidth) || 960;
  const tickN = wrapW < 520 ? 4 : 6;
  const step = Math.max(1, Math.round(nBars / tickN));
  for (let i = 0; i < nBars; i += step) {
    const t = svgEl('text', {
      x: x(i), y: H - 8, fill: 'var(--ink-3)', 'font-size': '11',
      'text-anchor': 'middle', 'font-family': 'var(--font-mono)',
    });
    t.textContent = fmtAxis(vis[i].t);
    svg.appendChild(t);
  }

  drawSignalRail(svg, klines, vis, view, x);

  if (hover >= 0 && hover < nBars) {
    const xc = x(hover);
    svg.appendChild(svgEl('line', {
      x1: xc, x2: xc, y1: PAD.t, y2: H - PAD.b,
      stroke: 'var(--ink-1)', 'stroke-width': '1', opacity: '.25',
    }));
  }
}

export function patchLastCandle(klines) {
  const s = state.chartScale;
  if (!s || !klines.length) return false;
  if (state.hover >= 0 || state.drag) return false;
  if (!s.follow || klines.length !== s.fullN) return false;
  const view = chartSlice(klines);
  const k = view.bars[view.bars.length - 1];
  if (!k || view.bars.length !== s.nBars || k.t !== s.lastT) return false;
  if (k.h > s.hi || k.l < s.lo) return false;
  const wick = document.getElementById('ck-wick');
  const body = document.getElementById('ck-body');
  const lastLine = document.getElementById('ck-last');
  const p9 = document.getElementById('ck-ema9');
  const p21 = document.getElementById('ck-ema21');
  if (!wick || !body) return false;
  if (state.ind.last && !lastLine) return false;
  if (state.ind.boll) {
    const lastB = view.bollUp[view.bollUp.length - 1];
    const lastD = view.bollDn[view.bollDn.length - 1];
    if (state.ind.boll2 && lastB != null && lastB > s.hi) return false;
    if (state.ind.boll2 && lastD != null && lastD < s.lo) return false;
    if (state.ind.boll1) {
      const u1 = view.boll1Up[view.boll1Up.length - 1];
      const d1 = view.boll1Dn[view.boll1Dn.length - 1];
      if (u1 != null && u1 > s.hi) return false;
      if (d1 != null && d1 < s.lo) return false;
    }
    if (state.ind.boll3) {
      const u3 = view.boll3Up[view.boll3Up.length - 1];
      const d3 = view.boll3Dn[view.boll3Dn.length - 1];
      if (u3 != null && u3 > s.hi) return false;
      if (d3 != null && d3 < s.lo) return false;
    }
  }
  const macdPane = findPane(s, 'macd');
  if (state.ind.macd && macdPane) {
    const lastH = view.macdHist[view.macdHist.length - 1];
    if (lastH != null && (lastH > macdPane.hi || lastH < macdPane.lo)) return false;
  }
  const usidxPane = findPane(s, 'usidx');
  if (state.ind.usidx && usidxPane && state.usidxTicker) return false;
  // 箱体破位或超级趋势换向都会改变配色与标签，交回整图重绘
  let stLive = null;
  if (state.ind.box) {
    const bx = getBox(klines);
    if ((bx ? bx.sig : '') !== s.boxSig) return false;
  }
  if (state.ind.st) {
    stLive = getSuperTrend(klines);
    if ((stLive ? stLive.lastDir : 0) !== s.stDir) return false;
    if (stLive.last != null && (stLive.last > s.hi || stLive.last < s.lo)) return false;
  }
  const y = s.y, x = s.x;
  const up = k.c >= k.o;
  const color = up ? 'var(--up)' : 'var(--down)';
  wick.setAttribute('y1', String(y(k.h)));
  wick.setAttribute('y2', String(y(k.l)));
  wick.setAttribute('stroke', color);
  if (s.wickW != null) wick.setAttribute('stroke-width', String(s.wickW));
  const top = y(Math.max(k.o, k.c));
  const bot = y(Math.min(k.o, k.c));
  const bw = s.bodyW || 2;
  body.setAttribute('y', String(top));
  body.setAttribute('height', String(Math.max(Math.min(1.2, bw), bot - top)));
  body.setAttribute('stroke', color);
  if (s.bodyStroke != null) body.setAttribute('stroke-width', String(s.bodyStroke));
  body.setAttribute('fill', (up && s.hollowUp !== false) ? 'var(--bg)' : color);
  if (lastLine) {
    lastLine.setAttribute('y1', String(y(k.c)));
    lastLine.setAttribute('y2', String(y(k.c)));
  }
  s.lastPx = k.c;
  placeLastTag(k.c);
  placeFastTags();
  const d9 = lineD(view.e9, x, y);
  const d21 = lineD(view.e21, x, y);
  if (p9) p9.setAttribute('d', d9);
  if (p21) p21.setAttribute('d', d21);
  if (stLive && stLive.ok) {
    const a = Math.max(0, view.start);
    const b = a + view.bars.length;
    const pStUp = document.getElementById('ck-st-up');
    const pStDn = document.getElementById('ck-st-dn');
    if (pStUp) pStUp.setAttribute('d', lineSegD(stLive.up.slice(a, b), x, y));
    if (pStDn) pStDn.setAttribute('d', lineSegD(stLive.dn.slice(a, b), x, y));
  }
  if (state.ind.boll) {
    const pu = document.getElementById('ck-boll-up');
    const pm = document.getElementById('ck-boll-mid');
    const pd = document.getElementById('ck-boll-dn');
    const pf = document.getElementById('ck-boll-fill');
    const p1u = document.getElementById('ck-boll1-up');
    const p1d = document.getElementById('ck-boll1-dn');
    const pf1 = document.getElementById('ck-boll1-fill');
    const p3u = document.getElementById('ck-boll3-up');
    const p3d = document.getElementById('ck-boll3-dn');
    const pf3 = document.getElementById('ck-boll3-fill');
    if (pu) pu.setAttribute('d', lineD(view.bollUp, x, y));
    if (pm) pm.setAttribute('d', lineD(view.bollMid, x, y));
    if (pd) pd.setAttribute('d', lineD(view.bollDn, x, y));
    if (pf) pf.setAttribute('d', bollAreaD(view.bollUp, view.bollDn, x, y));
    if (p1u) p1u.setAttribute('d', lineD(view.boll1Up, x, y));
    if (p1d) p1d.setAttribute('d', lineD(view.boll1Dn, x, y));
    if (pf1) pf1.setAttribute('d', bollAreaD(view.boll1Up, view.boll1Dn, x, y));
    if (p3u) p3u.setAttribute('d', lineD(view.boll3Up, x, y));
    if (p3d) p3d.setAttribute('d', lineD(view.boll3Dn, x, y));
    if (pf3) pf3.setAttribute('d', bollAreaD(view.boll3Up, view.boll3Dn, x, y));
  }
  if (state.ind.macd && macdPane) {
    const yM = (v) => paneY(macdPane, v);
    const pdif = document.getElementById('ck-macd-dif');
    const pdea = document.getElementById('ck-macd-dea');
    const ph = document.getElementById('ck-macd-h');
    const plast = document.getElementById('ck-macd-last');
    if (pdif) pdif.setAttribute('d', lineD(view.macdDif, x, yM));
    if (pdea) pdea.setAttribute('d', lineD(view.macdDea, x, yM));
    const lastH = view.macdHist[view.macdHist.length - 1];
    if (ph && lastH != null) {
      const y1 = yM(lastH), y0 = yM(0);
      ph.setAttribute('y', String(Math.min(y0, y1)));
      ph.setAttribute('height', String(Math.max(1.2, Math.abs(y1 - y0))));
      ph.setAttribute('fill', lastH >= 0 ? 'var(--up)' : 'var(--down)');
    }
    if (plast && lastH != null) {
      plast.setAttribute('y', String(yM(lastH) + 3));
      plast.textContent = lastH.toFixed(2);
    }
  }
  const rsiPane = findPane(s, 'rsi');
  if (state.ind.rsi && rsiPane) {
    const yR = (v) => paneY(rsiPane, v);
    const prsi = document.getElementById('ck-rsi');
    const plab = document.getElementById('ck-rsi-lab');
    const plast = document.getElementById('ck-rsi-last');
    if (prsi) prsi.setAttribute('d', lineD(view.rsi, x, yR));
    const lastR = view.rsi[view.rsi.length - 1];
    if (plab) plab.textContent = 'RSI ' + (state.rsiN || 14) + (lastR == null ? '' : '  ' + lastR.toFixed(1));
    if (plast && lastR != null) {
      plast.setAttribute('y', String(yR(lastR) + 3));
      plast.setAttribute('fill', lastR >= 70 ? 'var(--down)' : lastR <= 30 ? 'var(--up)' : 'var(--ink-3)');
      plast.textContent = lastR.toFixed(1);
    }
  }
  return true;
}

export function paintChart(klines) {
  if (state.barClosed || !patchLastCandle(klines)) drawChart(klines, state.ticker, state.hover);
  updateZoomLabel();
}

export function hideCrosshair() {
  const el = $('crosshair');
  if (el) el.classList.remove('show');
}

export function placeLastTag(price) {
  const tag = $('lastTag');
  const wrap = $('chartWrap');
  const s = state.chartScale;
  if (!tag || !wrap) return;
  if (!state.ind.last || price == null || !s || !s.y) {
    tag.classList.remove('show');
    return;
  }
  const yy = s.y(price);
  const yPx = yy / H * wrap.clientHeight;
  tag.style.top = Math.min(wrap.clientHeight - 12, Math.max(12, yPx)) + 'px';
  tag.textContent = px(price);
  tag.classList.add('show');
}

export function pointerToSvg(e) {
  const svg = $('chart');
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    mx: (e.clientX - r.left) / r.width * W,
    my: (e.clientY - r.top) / r.height * H,
  };
}

export function updateCrosshair(mx, my) {
  const layer = $('crosshair');
  const line = $('crossH');
  const tag = $('crossPrice');
  const wrap = $('chartWrap');
  const s = state.chartScale;
  if (!layer || !line || !tag || !wrap || !s) {
    hideCrosshair();
    return false;
  }
  const top = s.plotTop == null ? PAD.t : s.plotTop;
  const bot = s.plotBottom == null ? (H - PAD.b) : s.plotBottom;
  const panes = s.panes || [];
  let paneHit = null;
  if (my < top || my > bot) {
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i];
      if (my >= p.top && my <= p.top + p.h) { paneHit = p; break; }
    }
  }
  if (mx < PAD.l || mx > W - PAD.r || ((my < top || my > bot) && !paneHit)) {
    hideCrosshair();
    return false;
  }
  let text;
  if (paneHit) {
    const t = (my - paneHit.top) / Math.max(1, paneHit.h);
    const val = paneHit.hi - t * (paneHit.hi - paneHit.lo);
    text = paneHit.digits === 1 ? val.toFixed(1) : val.toFixed(3);
  } else {
    const t = (my - top) / Math.max(1, bot - top);
    text = px(s.hi - t * (s.hi - s.lo));
  }
  const yPx = my / H * wrap.clientHeight;
  line.style.left = (PAD.l / W * 100) + '%';
  line.style.right = (PAD.r / W * 100) + '%';
  line.style.top = yPx + 'px';
  tag.style.top = Math.min(wrap.clientHeight - 12, Math.max(12, yPx)) + 'px';
  tag.textContent = text;
  layer.classList.add('show');
  return true;
}

export function refreshCrosshair() {
  if (state.drag || !state.pointer) {
    hideCrosshair();
    return;
  }
  const p = pointerToSvg(state.pointer);
  if (!p) {
    hideCrosshair();
    return;
  }
  updateCrosshair(p.mx, p.my);
}

export function placeTip(e, html) {
  const wrap = $('chartWrap');
  const tip = $('tip');
  tip.innerHTML = html;
  tip.classList.add('show');
  const wr = wrap.getBoundingClientRect();
  let left = e.clientX - wr.left + 12;
  let top = e.clientY - wr.top + 12;
  if (left > wr.width - 180) left -= 190;
  if (top > wr.height - 90) top -= 90;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

export function showTip(e, klines) {
  const view = chartSlice(klines);
  if (!view.count) return;
  const p = pointerToSvg(e);
  if (!p) return;
  updateCrosshair(p.mx, p.my);
  const plotW = W - PAD.l - PAD.r;
  const slot = plotW / Math.max(1, view.count);
  const slotI = Math.min(view.count - 1, Math.max(0, Math.floor((p.mx - PAD.l) / slot)));
  const i0 = Math.max(0, view.start);
  const i = slotI - (i0 - view.start);
  if (i < 0 || i >= view.bars.length) {
    $('tip').classList.remove('show');
    if (state.hover !== -1) {
      state.hover = -1;
      drawChart(klines, state.ticker, -1);
    }
    return;
  }
  const k = view.bars[i];
  const chg = k.c - k.o;
  let extra = '';
  if (state.ind.boll && view.bollMid[i] != null) {
    extra = '<br>BOLL ' + px(view.bollUp[i]) + ' / ' + px(view.bollMid[i]) + ' / ' + px(view.bollDn[i]);
    if (view.pb[i] != null) extra += '<br>%B ' + view.pb[i].toFixed(2);
    if (view.bw[i] != null) extra += '  带宽 ' + (view.bw[i] * 100).toFixed(2) + '%';
  }
  if (state.ind.macd && view.macdHist[i] != null) {
    extra += '<br>MACD柱 ' + view.macdHist[i].toFixed(3);
    if (view.macdDif[i] != null && view.macdDea[i] != null) {
      extra += '  DIF ' + view.macdDif[i].toFixed(3) + '  DEA ' + view.macdDea[i].toFixed(3);
    }
  }
  if (state.ind.rsi && view.rsi && view.rsi[i] != null) {
    extra += '<br>RSI' + (state.rsiN || 14) + ' ' + view.rsi[i].toFixed(1);
  }
  if (state.ind.st) {
    const pack = getSuperTrend(klines);
    const gi = i + i0;
    if (pack && pack.ok && pack.st[gi] != null) {
      extra += '<br>超级趋势 ' + px(pack.st[gi]) + '  ' + (pack.dir[gi] > 0 ? '多' : '空') +
        '（' + pack.period + '×' + pack.mult + '）';
    } else {
      extra += '<br>' + ((pack && pack.why) || '超级趋势样本不足');
    }
  }
  if (state.ind.box) {
    const pack = getBox(klines);
    extra += '<br>' + (pack && pack.ok
      ? ('箱体 ' + px(pack.bottom) + '–' + px(pack.top) + '  ' + pack.statusLab +
        (pack.pos != null ? '  位置 ' + Math.round(pack.pos * 100) + '%' : '') +
        (pack.extension ? '  ' + pack.extensionLab : '  扩展无足够方向证据') +
        (pack.target != null ? '  量度目标 ' + px(pack.target) + '（结构参考）' : ''))
      : '箱体未现');
  }
  if (state.ind.hkld) {
    const pack = getHkld(klines);
    extra += '<br>' + (pack && pack.ok
      ? ((pack.label || '高空低多') +
        (pack.kind === 'break' && pack.breakLevel != null ? '  破位 ' + px(pack.breakLevel) : '') +
        (pack.longPx != null ? '  低多 ' + px(pack.longPx) : '') +
        (pack.shortPx != null ? '  高空 ' + px(pack.shortPx) : '') +
        (pack.grav != null ? '  重心 ' + pack.grav.toFixed(1) : ''))
      : (pack && pack.why ? pack.why : '高空低多样本不足'));
  }
  if (state.ind.hs) {
    const pack = getHs(klines);
    const gi = i + i0;
    const hit = (pack.patterns || []).find((p) => gi >= p.ls.i && gi <= Math.max(p.rs.i, p.breakI || p.rs.i) + 8);
    if (hit) extra += '<br>' + hit.title;
  }
  if (state.ind.sr) {
    const pack = getSr(klines);
    const rad = pack.radius || 0;
    const hit = (pack.levels || []).find((lv) => k.h >= lv.price - rad && k.l <= lv.price + rad);
    extra += '<br>' + (hit ? srTitle(hit, k.c) : (pack.label || '支压未现'));
  }
  if (state.ind.fib) {
    const pack = getFib(klines);
    if (pack && pack.ok) {
      const rad = pack.radius || 0;
      const hit = (pack.levels || []).find((lv) => k.h >= lv.price - rad && k.l <= lv.price + rad);
      extra += '<br>' + (hit
        ? ('斐波那契 ' + fibRatioText(hit.r) + ' ' + px(hit.price))
        : (pack.label || '斐波那契未现'));
    } else {
      extra += '<br>' + ((pack && pack.why) || '斐波那契未现');
    }
  }
  if (state.ind.bounce || state.ind.pull) {
    const pack = getPb(klines);
    const gi = i + i0;
    function pbHit(s) {
      if (!s || s.status === 'none') return false;
      const a = Math.min(s.fromI, s.extI);
      const b = Math.max(s.extI, s.recI >= 0 ? s.recI : s.pbI >= 0 ? s.pbI : s.extI);
      return gi >= a && gi <= b + 6;
    }
    if (state.ind.bounce && pbHit(pack.bounce)) extra += '<br>' + pack.bounce.title;
    if (state.ind.pull && pbHit(pack.pull)) extra += '<br>' + pack.pull.title;
  }
  if (state.ind.hold) {
    const pack = getHold(klines);
    const gi = i + i0;
    const hit = (pack.marks || []).find((mk) => mk.i === gi);
    extra += '<br>' + (hit ? (hit.lab + ' ' + px(hit.price)) : (pack.label || '企稳未现'));
  }
  const html =
    fmtBarTime(k.t) + '<br>开 ' + px(k.o) + '  高 ' + px(k.h) +
    '<br>低 ' + px(k.l) + '  收 ' + px(k.c) +
    '<br>' + (chg >= 0 ? '+' : '') + px(chg) + extra;
  placeTip(e, html);
  if (state.hover === i) return;
  state.hover = i;
  drawChart(klines, state.ticker, i);
}

export const wrap = $('chartWrap');
