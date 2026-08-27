import { barsClosedAsOf, closedFastBars, fiveBars, minuteBars } from '../core/bars.js';
import { bucket10, n, pad2, px } from '../core/format.js';
import { atr, bollCore, ema, rsi } from '../core/math.js';
import { mtfLean } from '../judge/votes.js';
import { getJson, klineUrl, parseKlines, upsertBar } from '../net/rest.js';
import { $, FAST_LIMIT, SIM_AUTO_DEFAULTS, isMarketOpen, mkt, state } from '../state.js';
import { fastCoolMs, fastHoldMs, recordFastSimClose, recordFastSimOpen, simPnl, tickSimTrade } from './sim.js';
import { scheduleChart } from '../view/panels.js';
import { renderFastPanel } from '../view/trade-overlay.js';

export function applyPriceToFast(price, nowMs) {
  if (price == null) return false;
  nowMs = nowMs || Date.now();
  const bucket = bucket10(nowMs);
  const list = state.fast || [];
  if (!list.length) {
    state.fast = [{ t: bucket, o: price, h: price, l: price, c: price }];
    return false;
  }
  const last = list[list.length - 1];
  if (bucket < last.t) {
    last.c = price;
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
    return false;
  }
  if (bucket === last.t) {
    last.c = price;
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
    return false;
  }
  const bar = {
    t: bucket,
    o: last.c,
    h: Math.max(last.c, price),
    l: Math.min(last.c, price),
    c: price,
  };
  state.fast = upsertBar(list, bar, FAST_LIMIT);
  return true;
}

export function applyTickBar(price) {
  const closedFast = applyPriceToFast(price);
  if (state.tf === '10s' && price != null && state.klines.length) {
    const bucket = bucket10(Date.now());
    const last = state.klines[state.klines.length - 1];
    if (bucket < last.t) {
      last.c = price;
      last.h = Math.max(last.h, price);
      last.l = Math.min(last.l, price);
      scheduleChart();
    } else if (bucket === last.t) {
      last.c = price;
      last.h = Math.max(last.h, price);
      last.l = Math.min(last.l, price);
      scheduleChart();
    } else {
      state.barClosed = true;
      const bar = {
        t: bucket,
        o: last.c,
        h: Math.max(last.c, price),
        l: Math.min(last.c, price),
        c: price,
      };
      state.klines = upsertBar(state.klines, bar, state.limit);
      scheduleChart();
    }
  }
  if (closedFast) onFastBarClosed();
  else tickFastOpen();
  tickSimTrade(price);
}

export async function refresh10sTail() {
  if (state.inflight || state.paused) return;
  try {
    const reqId = state.reqId;
    const kl = await getJson(klineUrl('10s', 30));
    if (reqId !== state.reqId) return;
    const bars = parseKlines(kl);
    const bucket = bucket10(Date.now());
    let added = false;
    bars.forEach((bar) => {
      if (bar.t >= bucket) return;
      const before = state.fast.length ? state.fast[state.fast.length - 1].t : 0;
      state.fast = upsertBar(state.fast, bar, FAST_LIMIT);
      if (bar.t > before) added = true;
      if (state.tf === '10s') state.klines = upsertBar(state.klines, bar, state.limit);
    });
    if (state.tf === '10s') scheduleChart();
    if (added) onFastBarClosed();
  } catch (e) { /* 实时报价仍可用 */ }
}

export async function loadFast() {
  try {
    const reqId = state.reqId;
    const kl = await getJson(klineUrl('10s', FAST_LIMIT));
    if (reqId !== state.reqId) return;
    const bars = parseKlines(kl);
    const live = state.fast || [];
    let next = bars.slice();
    live.forEach((b) => { next = upsertBar(next, b, FAST_LIMIT); });
    state.fast = next;
    if (state.ticker && state.ticker.last != null) applyPriceToFast(state.ticker.last);
    replayFastHistory();
    renderFastPanel();
    if (state.ind.fast) scheduleChart();
  } catch (e) { /* 主图仍可用 */ }
}

export function spreadOf(ticker) {
  if (!ticker || ticker.ask == null || ticker.bid == null) return null;
  const s = ticker.ask - ticker.bid;
  return s > 0 ? s : null;
}

export function markPrice(dir, ticker) {
  if (!ticker) return null;
  if (dir > 0 && ticker.bid != null) return ticker.bid;
  if (dir < 0 && ticker.ask != null) return ticker.ask;
  return ticker.last != null ? ticker.last : null;
}

export function entryMarkPrice(dir, ticker) {
  if (!ticker) return null;
  if (dir > 0 && ticker.ask != null) return ticker.ask;
  if (dir < 0 && ticker.bid != null) return ticker.bid;
  return ticker.last != null ? ticker.last : null;
}

export function reclaimOnBar(bars, dir) {
  const period = state.bollN || 20;
  const kMul = state.bollK || 2;
  const n = bars.length;
  if (n < period + 2) return false;
  const closes = bars.map((k) => k.c);
  const core = bollCore(closes, period);
  const i = n - 1;
  const last = bars[i];
  const prev = bars[i - 1];
  if (core.mid[i] == null || core.sd[i] == null) return false;
  const up = core.mid[i] + kMul * core.sd[i];
  const lo = core.mid[i] - kMul * core.sd[i];
  const upP = (core.mid[i - 1] != null && core.sd[i - 1] != null)
    ? core.mid[i - 1] + kMul * core.sd[i - 1] : up;
  const loP = (core.mid[i - 1] != null && core.sd[i - 1] != null)
    ? core.mid[i - 1] - kMul * core.sd[i - 1] : lo;
  const body = Math.abs(last.c - last.o);
  const loWick = Math.min(last.o, last.c) - last.l;
  const hiWick = last.h - Math.max(last.o, last.c);
  if (dir > 0) {
    const pierced = last.l <= lo || (prev && (prev.c < loP || prev.l <= loP));
    const back = last.c >= lo && last.c <= up;
    const bull = last.c >= last.o || loWick > body * 1.5;
    return pierced && back && bull;
  }
  const pierced = last.h >= up || (prev && (prev.c > upP || prev.h >= upP));
  const back = last.c <= up && last.c >= lo;
  const bear = last.c <= last.o || hiWick > body * 1.5;
  return pierced && back && bear;
}

export function emaPullback(bars, dir) {
  const n = bars.length;
  if (n < 12) return false;
  const closes = bars.map((k) => k.c);
  const e9 = ema(closes, 9);
  const last = bars[n - 1];
  const prev = bars[n - 2];
  const a = e9[n - 1];
  const aPrev = e9[n - 2];
  if (a == null || aPrev == null || !prev) return false;
  if (dir > 0) return prev.c <= aPrev && prev.l <= aPrev && last.c > a && last.c >= last.o;
  return prev.c >= aPrev && prev.h >= aPrev && last.c < a && last.c <= last.o;
}

export function clampFastDist(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function fastBounds(last) {
  const spec = mkt().fast;
  const tick = mkt().tick;
  if (spec.tpMin != null) {
    return { tpMin: spec.tpMin, tpMax: spec.tpMax, slMin: spec.slMin, slMax: spec.slMax };
  }
  const pxLast = last || 0;
  const lo = Math.max(tick * 8, pxLast * spec.pctMin);
  const hi = Math.max(tick * 20, pxLast * spec.pctMax);
  return {
    tpMin: lo,
    tpMax: hi,
    slMin: Math.max(tick * 6, lo * 0.75),
    slMax: Math.max(tick * 16, hi * 0.8),
  };
}

export function makeFastTrade(dir, bars, i, atr1, spread, reason, setup, spanSec) {
  const bar = bars[i];
  // 信号入场价取收盘；往返点差在 simPnl / closeSnapshot 中扣一次
  const entry = bar.c;
  if (entry == null || atr1 == null || atr1 <= 0) return null;
  const extreme = dir > 0 ? bar.l : bar.h;
  const wick = Math.abs(entry - extreme);
  const spec = mkt().fast;
  const bounds = fastBounds(entry);
  const auto = state.simAutoParams || SIM_AUTO_DEFAULTS;
  let tpDist = clampFastDist(auto.tpAtr * atr1, bounds.tpMin, bounds.tpMax);
  let slDist = clampFastDist(Math.max(auto.slAtr * atr1, wick * 1.8), bounds.slMin, bounds.slMax);
  if (spreadTooWide(spread, tpDist)) return null;
  if (spread != null) slDist = Math.max(slDist, 4 * spread);
  const tp = dir > 0 ? entry + tpDist : entry - tpDist;
  const sl = dir > 0 ? entry - slDist : entry + slDist;
  if (dir > 0 && !(tp > entry && sl < entry)) return null;
  if (dir < 0 && !(tp < entry && sl > entry)) return null;
  const span = spanSec || 10;
  return {
    dir: dir,
    entry: entry,
    tp: tp,
    sl: sl,
    t: bar.t,
    entryAt: (bar.t + span) * 1000,
    reason: reason,
    setup: setup,
    status: 'open',
    spread: spread,
    atr: atr1,
  };
}

export function spreadTooWide(spread, tpDist) {
  // 盘口缺失时拒绝开单，避免静默关掉点差保护
  if (spread == null || !(spread > 0)) return true;
  if (tpDist == null || !(tpDist > 0)) return spread >= 0.8;
  return spread >= 0.08 * tpDist;
}

export function fastContext(bars, ticker) {
  if (!bars || bars.length < 12) return null;
  const n = bars.length;
  const t = bars[n - 1].t;
  const m1 = barsClosedAsOf(minuteBars(), 60, t);
  const m5 = barsClosedAsOf(fiveBars(), 300, t);
  const m1b = mtfLean(m1);
  const m5b = mtfLean(m5);
  const spread = spreadOf(ticker);
  const a1 = atr(m1, 14);
  const closes = bars.map((k) => k.c);
  const e9 = ema(closes, 9);
  const a = e9[n - 1];
  const last = bars[n - 1];
  const r = rsi(closes, state.rsiN || 14);
  const ready = m1.length >= 21 && m5.length >= 21;
  const allowLong = ready && m1b.vote >= 0 && m5b.vote >= 0;
  const allowShort = ready && m1b.vote <= 0 && m5b.vote <= 0;
  const trendLong = ready && m1b.vote > 0 && m5b.vote >= 0;
  const trendShort = ready && m1b.vote < 0 && m5b.vote <= 0;
  return {
    n: n, t: t, m1: m1, m5: m5, m1b: m1b, m5b: m5b,
    spread: spread, a1: a1, a: a, last: last, r: r,
    allowLong: allowLong, allowShort: allowShort,
    trendLong: trendLong, trendShort: trendShort,
  };
}

export function fastWaitWhy(ctx, ticker) {
  if (!isMarketOpen(ticker)) return '休市，开盘后再给开单信号。';
  if (!ctx) return '还在补 10 秒 K 线。';
  if (ctx.a1 == null) return '还在补 1 分钟波动，样本不够。';
  const bounds = fastBounds(ctx.last && ctx.last.c);
  const spec = mkt().fast;
  const tpGuess = clampFastDist((state.simAutoParams.tpAtr || SIM_AUTO_DEFAULTS.tpAtr) * ctx.a1, bounds.tpMin, bounds.tpMax);
  if (spreadTooWide(ctx.spread, tpGuess)) {
    if (ctx.spread == null || !(ctx.spread > 0)) return '盘口点差暂缺，暂停开单。';
    return '点差 ' + px(ctx.spread, 2) + ' 相对目标过大，暂停开单。';
  }
  if (ctx.m5b.vote > 0 && ctx.m1b.vote < 0) return '5分钟偏多，1分钟还偏空。等1分钟转多再开。';
  if (ctx.m5b.vote < 0 && ctx.m1b.vote > 0) return '5分钟偏空，1分钟还偏多。等1分钟转空再开。';
  if (ctx.m5b.vote === 0 && ctx.m1b.vote === 0) {
    return '1分和5分都还缠着。等扫到布林外轨收回，或均线重新排开。';
  }
  if (ctx.allowLong && ctx.r != null && ctx.r > 78) return '方向可以做多，但 RSI 过高，不追多。等回落。';
  if (ctx.allowShort && ctx.r != null && ctx.r < 22) return '方向可以做空，但 RSI 过低，不追空。等反抽。';
  if (ctx.trendLong) return '1分5分偏多。等10秒回踩 EMA9 后收盘站上，或下轨收回。';
  if (ctx.trendShort) return '1分5分偏空。等10秒反抽 EMA9 后收盘跌破，或上轨收回。';
  if (ctx.allowLong) return '方向不空。等下轨收回并站上均线。';
  if (ctx.allowShort) return '方向不多。等上轨收回并跌破均线。';
  return '等 10 秒收盘后的回踩或触轨收回。';
}

export function tryFastDir(dir, ok, rsiV, bars, i, atr1, spread, reason, setup, spanSec) {
  if (!ok) return null;
  if (dir > 0 && rsiV != null && rsiV > 78) return null;
  if (dir < 0 && rsiV != null && rsiV < 22) return null;
  return makeFastTrade(dir, bars, i, atr1, spread, reason, setup, spanSec);
}

export function evalFastSetup(bars, ticker, preview) {
  if (!bars || bars.length < 30) return null;
  const ctx = fastContext(bars, ticker);
  if (!ctx || ctx.a1 == null) return null;
  const n = ctx.n;
  const last = ctx.last;
  const a = ctx.a;
  const r = ctx.r;
  const a1 = ctx.a1;
  const spread = ctx.spread;

  if (reclaimOnBar(bars, 1) && a != null && last.c > a) {
    const tr = tryFastDir(1, ctx.allowLong, r, bars, n - 1, a1, spread,
      '10秒下轨收回并站上均线，1分钟不空', 'reclaim', 10);
    if (tr) return tr;
  }
  if (reclaimOnBar(bars, -1) && a != null && last.c < a) {
    const tr = tryFastDir(-1, ctx.allowShort, r, bars, n - 1, a1, spread,
      '10秒上轨收回并跌破均线，1分钟不多', 'reclaim', 10);
    if (tr) return tr;
  }
  if (emaPullback(bars, 1)) {
    const tr = tryFastDir(1, ctx.trendLong, r, bars, n - 1, a1, spread,
      '10秒回踩EMA9后收盘站上，1分钟偏多', 'ema', 10);
    if (tr) return tr;
  }
  if (emaPullback(bars, -1)) {
    const tr = tryFastDir(-1, ctx.trendShort, r, bars, n - 1, a1, spread,
      '10秒回抽EMA9后收盘跌破，1分钟偏空', 'ema', 10);
    if (tr) return tr;
  }
  if (!preview && ctx.m1 && ctx.m1.length >= 30) {
    const m1 = ctx.m1;
    const close1 = m1[m1.length - 1].t + 60;
    const just1 = close1 > ctx.t && close1 <= ctx.t + 10;
    if (just1) {
      const m1last = m1[m1.length - 1];
      const m1e9 = ema(m1.map((k) => k.c), 9);
      const m1a = m1e9[m1e9.length - 1];
      if (reclaimOnBar(m1, 1) && m1a != null && m1last.c > m1a) {
        const tr = tryFastDir(1, ctx.allowLong, r, m1, m1.length - 1, a1, spread,
          '1分钟下轨收回并站上均线', 'reclaim1', 60);
        if (tr) return tr;
      }
      if (reclaimOnBar(m1, -1) && m1a != null && m1last.c < m1a) {
        const tr = tryFastDir(-1, ctx.allowShort, r, m1, m1.length - 1, a1, spread,
          '1分钟上轨收回并跌破均线', 'reclaim1', 60);
        if (tr) return tr;
      }
      if (emaPullback(m1, 1)) {
        const tr = tryFastDir(1, ctx.trendLong, r, m1, m1.length - 1, a1, spread,
          '1分钟回踩EMA9后收盘站上', 'ema1', 60);
        if (tr) return tr;
      }
      if (emaPullback(m1, -1)) {
        const tr = tryFastDir(-1, ctx.trendShort, r, m1, m1.length - 1, a1, spread,
          '1分钟反抽EMA9后收盘跌破', 'ema1', 60);
        if (tr) return tr;
      }
    }
  }
  return null;
}

export function hitOnBar(tr, bar, now) {
  if (tr.dir > 0) {
    if (bar.l <= tr.sl) return closeSnapshot(tr, 'sl', tr.sl, now);
    if (bar.h >= tr.tp) return closeSnapshot(tr, 'tp', tr.tp, now);
  } else {
    if (bar.h >= tr.sl) return closeSnapshot(tr, 'sl', tr.sl, now);
    if (bar.l <= tr.tp) return closeSnapshot(tr, 'tp', tr.tp, now);
  }
  if (now - tr.entryAt >= fastHoldMs()) return closeSnapshot(tr, 'time', bar.c, now);
  return null;
}

export function closeSnapshot(tr, kind, price, now) {
  return {
    dir: tr.dir,
    entry: tr.entry,
    tp: tr.tp,
    sl: tr.sl,
    t: tr.t,
    entryAt: tr.entryAt,
    reason: tr.reason,
    setup: tr.setup,
    status: kind,
    exit: price,
    exitAt: now,
    spread: tr.spread,
    pnl: simPnl(tr.entry, price, tr.dir, tr.spread),
  };
}

export function againstCount(tr, closed) {
  let n = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    const b = closed[i];
    if (b.t <= tr.t) break;
    const bad = tr.dir > 0 ? b.c < tr.entry : b.c > tr.entry;
    if (!bad) break;
    n += 1;
  }
  return n;
}

export function replayFastHistory() {
  if (state.fastReplay) return;
  const all = closedFastBars(Date.now());
  if (all.length < 40) return;
  const m1 = minuteBars();
  if (!m1 || m1.length < 16) return;
  const m5 = fiveBars();
  if (!m5 || m5.length < 16) return;
  // 冻结盘口快照，避免复盘途中点差跳动；仍非历史撮合
  const ticker = state.ticker ? Object.assign({}, state.ticker) : null;
  const hist = [];
  const marks = [];
  let open = null;
  let coolT = 0;
  let openLeft = 0;
  for (let i = 30; i < all.length; i++) {
    const bar = all[i];
    const now = (bar.t + 10) * 1000;
    if (open) {
      const hit = hitOnBar(open, bar, now);
      if (!hit && againstCount(open, all.slice(0, i + 1)) >= 3) {
        closeFastReplay(open, 'invalid', bar.c, now, hist, marks);
        open = null;
        coolT = bar.t + Math.ceil(fastCoolMs() / 1000);
      } else if (hit) {
        hist.push(hit);
        marks.push({ t: open.t, dir: open.dir });
        open = null;
        coolT = bar.t + Math.ceil(fastCoolMs() / 1000);
      }
      continue;
    }
    if (bar.t < coolT) continue;
    const setup = evalFastSetup(all.slice(0, i + 1), ticker);
    if (setup) open = setup;
  }
  if (open) openLeft = 1;
  state.fastHist = hist.slice(-6);
  state.fastMarks = marks.slice(-12);
  state.fastReplay = true;
  state.fastReplayOpenLeft = openLeft;
  if (all.length) state.fastLastEvalT = all[all.length - 1].t;
}

export function closeFastReplay(tr, kind, price, now, hist, marks) {
  hist.push(closeSnapshot(tr, kind, price, now));
  marks.push({ t: tr.t, dir: tr.dir });
}

export function beepAlert(level) {
  // level: 'watch' (预警) | 'ready' (就绪) | 'open' (开单)
  if (!state.fastBeep) return;
  const tones = {
    watch: { freq: 660, dur: 0.08, vol: 0.03 },   // 预警：低频短促
    ready: { freq: 880, dur: 0.12, vol: 0.05 },   // 就绪：中频中等
    open: { freq: 1320, dur: 0.18, vol: 0.06 },   // 开单：高频长鸣
  };
  const cfg = tones[level] || tones.ready;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!state._ac) state._ac = new AC();
    const ctx = state._ac;
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = cfg.freq;
    g.gain.setValueAtTime(cfg.vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + cfg.dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + cfg.dur);
  } catch (e) { /* 静音环境忽略 */ }
}

export function beepFast() {
  beepAlert('ready');
}

export function closeFastTrade(kind, price, now) {
  const tr = state.fastTrade;
  if (!tr || tr.status !== 'open') return;
  const done = closeSnapshot(tr, kind, price, now);
  const simId = tr.simId;
  state.fastLast = done;
  state.fastHist = state.fastHist.concat([done]).slice(-6);
  state.fastMarks = state.fastMarks.concat([{ t: tr.t, dir: tr.dir }]).slice(-12);
  state.fastTrade = null;
  state.fastWatch = null;
  state.fastCoolUntil = now + fastCoolMs();
  recordFastSimClose(done, simId);
  state.chartScale = null;
  scheduleChart();
  renderFastPanel();
}

export function stepFastTrade(now, ticker) {
  const tr = state.fastTrade;
  if (!tr || tr.status !== 'open') return false;
  const px = markPrice(tr.dir, ticker);
  if (px == null) return false;
  let kind = null;
  if (tr.dir > 0) {
    if (px >= tr.tp) kind = 'tp';
    else if (px <= tr.sl) kind = 'sl';
  } else {
    if (px <= tr.tp) kind = 'tp';
    else if (px >= tr.sl) kind = 'sl';
  }
  if (!kind && now - tr.entryAt >= fastHoldMs()) kind = 'time';
  if (!kind && againstCount(tr, closedFastBars(now)) >= 3) kind = 'invalid';
  if (!kind) return false;
  const exit = kind === 'tp' ? tr.tp : kind === 'sl' ? tr.sl : px;
  closeFastTrade(kind, exit, now);
  return true;
}

export function formingFastBars(nowMs) {
  const list = state.fast || [];
  if (!list.length) return null;
  const bucket = bucket10(nowMs || Date.now());
  const last = list[list.length - 1];
  if (last.t !== bucket) return null;
  return list;
}

export function updateFastWatch(now, ticker) {
  const prev = state.fastWatch;
  function sameWatch(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.dir === b.dir && a.setup === b.setup && a.reason === b.reason;
  }
  if (!state.ind.fast || (state.fastTrade && state.fastTrade.status === 'open')) {
    state.fastWatch = null;
    return !sameWatch(prev, null);
  }
  if (!isMarketOpen(ticker) || now < state.fastCoolUntil) {
    state.fastWatch = null;
    return !sameWatch(prev, null);
  }
  const forming = formingFastBars(now);
  if (!forming || forming.length < 30) {
    state.fastWatch = null;
    return !sameWatch(prev, null);
  }
  const setup = evalFastSetup(forming, ticker, true);
  if (!setup) {
    state.fastWatch = null;
    return !sameWatch(prev, null);
  }
  const side = setup.dir > 0 ? '多' : '空';
  state.fastWatch = {
    dir: setup.dir,
    entry: setup.entry,
    tp: setup.tp,
    sl: setup.sl,
    setup: setup.setup,
    reason: '这根10秒若这样收盘，就开' + side + '。' + setup.reason,
  };
  return !sameWatch(prev, state.fastWatch);
}

export function tickFastOpen() {
  const t = state.ticker || {};
  const now = Date.now();
  if (state.fastTrade && state.fastTrade.status === 'open') {
    if (stepFastTrade(now, t)) return;
    const remainEl = $('fastRemain');
    if (remainEl && state.ind.fast) remainEl.textContent = '剩余 ' + remainFast(state.fastTrade, now);
    return;
  }

  // 倒计时预警逻辑：距离收盘 3 秒时触发
  const forming = formingFastBars(now);
  if (forming && forming.length && state.fastWatch) {
    const lastBar = forming[forming.length - 1];
    const closeAt = (lastBar.t + 10) * 1000;  // 10 秒收盘时刻
    const leftMs = closeAt - now;

    // 倒计时 3 秒时播放预警音（允许 2.8~3.2 秒误差窗口）
    if (leftMs > 2800 && leftMs <= 3200 && !state._fastWatchAlerted) {
      beepAlert('watch');
      state._fastWatchAlerted = true;  // 避免重复播放
    }
    // 重置标记（距离收盘还有 >3.5 秒时重置）
    if (leftMs > 3500) state._fastWatchAlerted = false;
  }

  const changed = updateFastWatch(now, t);
  if (changed && state.ind.fast) renderFastPanel();
}

export function tryOpenFast(now, ticker) {
  if (!state.ind.fast) return;
  if (!state.simAuto) return;
  if (state.fastTrade && state.fastTrade.status === 'open') return;
  if (now < state.fastCoolUntil) return;
  if (!isMarketOpen(ticker)) return;
  const closed = closedFastBars(now);
  if (closed.length < 30) return;
  const last = closed[closed.length - 1];
  if (last.t === state.fastLastEvalT) return;
  state.fastLastEvalT = last.t;
  const setup = evalFastSetup(closed, ticker, false);
  if (!setup) {
    updateFastWatch(now, ticker);
    return;
  }
  state.fastWatch = null;
  state.fastTrade = setup;
  state.fastLast = null;
  recordFastSimOpen(setup);
  beepAlert('open');  // 开单：高频长鸣
  state.chartScale = null;
  scheduleChart();
  renderFastPanel();
}

export function onFastBarClosed() {
  const t = state.ticker || {};
  const now = Date.now();
  stepFastTrade(now, t);
  tryOpenFast(now, t);
  updateFastWatch(now, t);
  renderFastPanel();
}

export function remainFast(tr, now) {
  const left = Math.max(0, Math.ceil((tr.entryAt + fastHoldMs() - now) / 1000));
  return Math.floor(left / 60) + ':' + pad2(left % 60);
}

export function fastKindLabel(kind) {
  if (kind === 'tp') return '止盈';
  if (kind === 'sl') return '止损';
  if (kind === 'time') return '超时';
  if (kind === 'invalid') return '失效';
  if (kind === 'manual') return '手平';
  if (kind === 'off') return '关闭';
  return kind || '';
}

export function simSourceLabel(o) {
  if (!o || o.source !== 'fast') return '手';
  const k = fastKindLabel(o.kind);
  return k ? '开单·' + k : '开单';
}

export function setupKindLabel(setup) {
  if (setup === 'ema' || setup === 'ema1') return '回踩';
  if (setup === 'reclaim' || setup === 'reclaim1') return '收回';
  return '';
}
