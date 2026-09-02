import { klinesClosed } from '../core/bars.js';
import { atrFallback, px } from '../core/format.js';
import { atr, rsi, swings } from '../core/math.js';
import { bollMacdSignal, getBollMacd } from '../indicators/boll.js';
import { getFib } from '../indicators/fib.js';
import { getHkld } from '../indicators/hkld.js';
import { getHold } from '../indicators/hold.js';
import { getHs } from '../indicators/hs.js';
import { getPb } from '../indicators/pb.js';
import { getSmc } from '../indicators/smc.js';
import { getSr, srPivotK, srSwingDeviation } from '../indicators/sr.js';
import { getStack } from '../indicators/stack.js';
import { getTrap } from '../indicators/trap.js';
import { CORE_FAMILIES, FAC_FAMILY_LAB, FAC_FAMILY_W, JUDGE_NET_RATIO, factorFamilyId, factorOn, pickFamilyVote } from './factors.js';
import { bollVote, dayVote, dxyVote, emaVote, macdVote, mtfVote, rsiVote, smcVote, tape, vwapVote, xauUsidxVote } from './votes.js';
import { isMarketOpen, mkt, state } from '../state.js';

export function judge(klines, ticker, mtf) {
  const empty = { dir: '暂无', cls: 'chop', agree: '', hint: '还没有 K 线。', audit: '', auditWarn: false, factors: [] };
  if (!klines.length) return empty;
  const factors = [];
  // B3：计票只用已收盘 K；未收盘由各模块自行降级为预备
  const closed = klinesClosed(klines, state.tf);
  const voteSrc = closed.length >= 21 ? closed : [];
  const closes = (voteSrc.length ? voteSrc : klines).map((k) => k.c);
  const last = klines[klines.length - 1].c;
  const e = voteSrc.length ? emaVote(closes) : { vote: 0, why: '正在走的 K 只观察，收盘才确认。', a: null, b: null };
  const rsiN = state.rsiN || 14;
  const r = voteSrc.length ? rsi(closes, rsiN) : null;
  const rs = voteSrc.length ? rsiVote(r, rsiN) : { vote: 0, why: '正在走的 K 只观察，收盘才确认。' };
  const swingLast = voteSrc.length ? voteSrc[voteSrc.length - 1].c : last;
  const swingAtr = voteSrc.length ? (atr(voteSrc, 14) || atrFallback(swingLast)) : 0;
  const sw = voteSrc.length
    ? swings(voteSrc, srPivotK(state.tf), srSwingDeviation(swingLast, swingAtr))
    : { highs: [], lows: [] };
  const tp = voteSrc.length >= 3 ? tape(voteSrc) : { vote: 0, why: '正在走的 K 只观察，收盘才确认。' };

  if (factorOn('ema')) factors.push({ id: 'ema', name: '均线结构', vote: e.vote, why: e.why, core: true });
  if (factorOn('rsi')) factors.push({ id: 'rsi', name: 'RSI' + rsiN, vote: rs.vote, why: rs.why });
  if (factorOn('vwap')) {
    const vw = vwapVote(voteSrc.length ? voteSrc : klines);
    factors.push({ id: 'vwap', name: '日内均价', vote: voteSrc.length ? vw.vote : 0, why: voteSrc.length ? vw.why : '正在走的 K 只观察，收盘才确认。' });
  }
  if (factorOn('dxy')) {
    const dx = dxyVote(voteSrc.length ? voteSrc : klines, state.usidxBars);
    factors.push({ id: 'dxy', name: 'DXY对照', vote: voteSrc.length ? dx.vote : 0, why: voteSrc.length ? dx.why : '正在走的 K 只观察，收盘才确认。' });
  }
  if (factorOn('xauUsidx')) {
    const xr = xauUsidxVote(voteSrc.length ? voteSrc : klines, state.usidxBars);
    factors.push({ id: 'xauUsidx', name: 'XAU-USIDX相关', vote: voteSrc.length ? xr.vote : 0, why: voteSrc.length ? xr.why : '正在走的 K 只观察，收盘才确认。' });
  }

  if (factorOn('swing')) {
    if (sw.highs.length === 2 && sw.lows.length === 2) {
      const hh = sw.highs[1] > sw.highs[0];
      const hl = sw.lows[1] > sw.lows[0];
      if (hh && hl) factors.push({ id: 'swing', name: '高低点', vote: 1, why: '近端更高高点、更高低点' });
      else if (!hh && !hl) factors.push({ id: 'swing', name: '高低点', vote: -1, why: '近端更低高点、更低低点' });
      else factors.push({ id: 'swing', name: '高低点', vote: 0, why: '高低点不对齐，结构来回扫' });
    } else {
      factors.push({ id: 'swing', name: '高低点', vote: 0, why: voteSrc.length ? '摆动点还不够两对' : '正在走的 K 只观察，收盘才确认。' });
    }
  }

  if (factorOn('tape')) factors.push({ id: 'tape', name: '近端 K 线', vote: tp.vote, why: tp.why });

  let bollPack = null;
  let macdPack = null;
  let sigPack = null;
  const stackPack = factorOn('stack') ? getStack() : null;
  if (factorOn('boll') || factorOn('macd') || factorOn('sig')) {
    const bm = getBollMacd(voteSrc.length ? voteSrc : klines);
    if (factorOn('boll')) bollPack = bollVote(bm.boll);
    if (factorOn('macd')) macdPack = macdVote(voteSrc.length ? voteSrc : klines);
    if (factorOn('sig')) sigPack = bm.sig || bollMacdSignal(voteSrc.length ? voteSrc : klines);
    if (sigPack && sigPack.vote !== 0) {
      if (bollPack && bollPack.vote === sigPack.vote) {
        bollPack = { vote: 0, why: bollPack.why + '。方向票交给布林配 MACD，避免同一事件计两次' };
      }
      if (macdPack && macdPack.vote === sigPack.vote) {
        macdPack = { vote: 0, why: macdPack.why + '。方向票交给布林配 MACD，避免同一事件计两次' };
      }
    }
  }
  if (stackPack && stackPack.vote) {
    if (stackPack.kind === 'fade' && bollPack && bollPack.vote === stackPack.vote) {
      bollPack = { vote: 0, why: bollPack.why + '。同一段已记入套轨宽轨收回，布林方向票不计' };
    }
    if (stackPack.kind === 'open' && sigPack && sigPack.vote === stackPack.vote) {
      sigPack = Object.assign({}, sigPack, {
        vote: 0,
        why: sigPack.why + '。同一段已记入套轨开口，布林配 MACD 方向票不计。',
      });
    }
  }
  if (bollPack) factors.push({ id: 'boll', name: '布林', vote: voteSrc.length ? bollPack.vote : 0, why: voteSrc.length ? bollPack.why : '正在走的 K 只观察，收盘才确认。' });
  if (macdPack) factors.push({ id: 'macd', name: 'MACD', vote: voteSrc.length ? macdPack.vote : 0, why: voteSrc.length ? macdPack.why : '正在走的 K 只观察，收盘才确认。' });
  if (sigPack) factors.push({ id: 'sig', name: '布林配 MACD', vote: voteSrc.length ? sigPack.vote : 0, why: voteSrc.length ? sigPack.why : '正在走的 K 只观察，收盘才确认。' });
  if (stackPack) factors.push({ id: 'stack', name: '套轨', vote: stackPack.vote, why: stackPack.why, core: true });
  let hkldPack = factorOn('hkld') ? getHkld(voteSrc.length ? voteSrc : klines) : null;
  if (hkldPack) {
    let hv = hkldPack.vote;
    let hw = hkldPack.why;
    if (hv && hkldPack.kind === 'break' && stackPack && stackPack.kind === 'open' && stackPack.vote === hv) {
      hv = 0;
      hw = hw + '。同一段已记入套轨开口，突破反转方向票不计。';
    } else if (hv && hkldPack.kind === 'break') {
      const smcNow = getSmc(klines);
      const lastEv = smcNow.events && smcNow.events.length ? smcNow.events[smcNow.events.length - 1] : null;
      const nearEv = lastEv && lastEv.dir === hv && (klines.length - 1 - lastEv.i) <= 6
        && (lastEv.kind === 'BOS' || lastEv.kind === 'CHoCH');
      if (nearEv) {
        hv = 0;
        hw = hw + '。同一段已记入 SMC ' + lastEv.kind + '，突破反转方向票不计。';
      }
    } else if (hv && stackPack && stackPack.kind === 'fade' && stackPack.vote === hv) {
      hv = 0;
      hw = hw + '。同一段已记入套轨宽轨收回，高空低多方向票不计。';
    } else if (hv && sigPack && sigPack.vote === hv && /收回/.test(sigPack.label || sigPack.why || '')) {
      hv = 0;
      hw = hw + '。同一段已记入布林配 MACD 收回，高空低多方向票不计。';
    }
    if (!voteSrc.length) { hv = 0; hw = '正在走的 K 只观察，收盘才确认。'; }
    factors.push({ id: 'hkld', name: hkldPack.name || '高空低多', vote: hv, why: hw, core: false });
  }
  if (factorOn('range')) {
    const rk = hkldPack || getHkld(voteSrc.length ? voteSrc : klines);
    let rv = 0;
    let rw = '震荡位置：箱体高低还没算出来，暂时没有位置提示。';
    if (rk && rk.ok) {
      const boxW = rk.shortPx != null && rk.longPx != null ? rk.shortPx - rk.longPx : 0;
      const mid = boxW > 0 ? rk.longPx + boxW / 2 : null;
      const longWarm = rk.longStatus === 'trigger' || rk.longStatus === 'watch';
      const shortWarm = rk.shortStatus === 'trigger' || rk.shortStatus === 'watch';
      const nearLong = mid != null && last <= mid;
      const nearShort = mid != null && last >= mid;
      // 去重只看高空低多因子实际计的票（已经过 SMC/套轨等 steal 后），避免和它重复计
      const hkldFactor = factors.find((f) => f.id === 'hkld');
      const hkldVote = hkldFactor ? hkldFactor.vote : 0;
      if (rk.kind === 'break') {
        rw = '箱体已' + (rk.dir > 0 ? '上破' : '下破') + (rk.breakLevel != null ? ' ' + px(rk.breakLevel) : '') + '，停止回归，按突破方向切换。';
      } else if (longWarm && shortWarm) {
        rw = '低多带与高空带同时挂起，结构对打，点位不定，先观望。';
      } else if (longWarm && nearLong) {
        if (hkldVote > 0) rw = '现价在低多带（低多位置 ' + px(rk.longPx) + '），方向票已计入高空低多，位置不重复计。';
        else if (hkldVote < 0) rw = '现价在低多带（低多位置 ' + px(rk.longPx) + '），但高空低多当前给做空，位置与结构对打，先不站多。';
        else {
          rv = rk.longStatus === 'trigger' ? 1 : 0;
          rw = '现价贴近箱体下沿（低多位置 ' + px(rk.longPx) + '），进入低多带，' + (rk.longStatus === 'trigger' ? '只在此处等 1 分钟收回信号做多回归，止损放下沿外侧 1 ATR，目标中轴。' : '还差收回迹象，等 1 分钟收盘站上均线再动手。');
        }
      } else if (shortWarm && nearShort) {
        if (hkldVote < 0) rw = '现价在高空带（高空位置 ' + px(rk.shortPx) + '），方向票已计入高空低多，位置不重复计。';
        else if (hkldVote > 0) rw = '现价在高空带（高空位置 ' + px(rk.shortPx) + '），但高空低多当前给做多，位置与结构对打，先不站空。';
        else {
          rv = rk.shortStatus === 'trigger' ? -1 : 0;
          rw = '现价贴近箱体上沿（高空位置 ' + px(rk.shortPx) + '），进入高空带，' + (rk.shortStatus === 'trigger' ? '只在此处等 1 分钟收回信号做空回归，止损放上沿外侧 1 ATR，目标中轴。' : '还差收回迹象，等 1 分钟收盘跌破均线再动手。');
        }
      } else if (longWarm) {
        rw = '现价已离开低多带（低多位置 ' + px(rk.longPx) + '），点位不合格，等回落到边缘再按信号开枪。';
      } else if (shortWarm) {
        rw = '现价已离开高空带（高空位置 ' + px(rk.shortPx) + '），点位不合格，等回升到边缘再按信号开枪。';
      } else if (boxW > 0) {
        const pos = (last - rk.longPx) / boxW;
        if (pos <= 0.15 || pos >= 0.85) {
          rw = '现价贴近箱体' + (pos <= 0.15 ? '下沿' : '上沿') + '附近（箱体 ' + px(rk.longPx) + '–' + px(rk.shortPx) + '），但还差收回迹象，等 1 分钟收盘确认再动手。';
        } else {
          rw = '现价在箱体中轴附近（箱体 ' + px(rk.longPx) + '–' + px(rk.shortPx) + '），点位不合格，不开单，等回到边缘带再按信号开枪。';
        }
      }
    }
    factors.push({ id: 'range', name: '震荡位置', vote: rv, why: rw, core: false });
  }
  let trapPack = factorOn('trap') ? getTrap(voteSrc.length ? voteSrc : klines) : null;
  if (factorOn('smc')) {
    let s = smcVote(voteSrc.length ? voteSrc : klines);
    const smcPack = getSmc(voteSrc.length ? voteSrc : klines);
    const lastEv = smcPack.events && smcPack.events.length ? smcPack.events[smcPack.events.length - 1] : null;
    if (trapPack && trapPack.vote && s.vote && s.vote !== trapPack.vote) {
      if (lastEv && Math.abs(lastEv.i - trapPack.sweepI) <= 2) {
        s = {
          vote: 0,
          why: s.why + '。近端突破随后收回，按诱空/诱多处理，SMC 方向票不计',
          core: true,
        };
      }
    }
    if (trapPack && trapPack.vote && s.vote && s.vote === trapPack.vote && trapPack.status === 'trigger') {
      const near = s.signal
        ? Math.abs(s.signal.i - trapPack.sweepI) <= 3
        : (lastEv && Math.abs(lastEv.i - trapPack.sweepI) <= 2);
      if (near) {
        trapPack = Object.assign({}, trapPack, {
          vote: 0,
          why: trapPack.why + '。同一段已记入 SMC 做多/做空，诱空诱多方向票不计。',
        });
      }
    }
    if (!voteSrc.length) s = { vote: 0, why: '正在走的 K 只观察，收盘才确认。', core: true };
    factors.push({ id: 'smc', name: 'SMC', vote: s.vote, why: s.why, core: true });
  }
  if (factorOn('hs')) {
    const h = getHs(voteSrc.length ? voteSrc : klines);
    factors.push({ id: 'hs', name: '头肩形态', vote: voteSrc.length ? h.vote : 0, why: voteSrc.length ? h.why : '正在走的 K 只观察，收盘才确认。', core: false });
  }
  let srPack = null;
  if (factorOn('sr')) {
    srPack = getSr(voteSrc.length ? voteSrc : klines);
    let srVote = voteSrc.length ? srPack.vote : 0;
    let srWhy = voteSrc.length ? srPack.why : '正在走的 K 只观察，收盘才确认。';
    if (trapPack && trapPack.vote && srVote === trapPack.vote && /影线/.test(srWhy || '')) {
      srVote = 0;
      srWhy = srWhy + '。同一段更接近诱空/诱多扫位，支压方向票不计。';
    }
    srPack = Object.assign({}, srPack, { vote: srVote, why: srWhy });
    factors.push({ id: 'sr', name: '支撑压力', vote: srVote, why: srWhy, core: false });
  }
  if (trapPack) {
    const tName = trapPack.dir < 0 ? '诱多' : (trapPack.dir > 0 ? '诱空' : '诱空诱多');
    const tv = voteSrc.length ? trapPack.vote : 0;
    factors.push({ id: 'trap', name: tName, vote: tv, why: voteSrc.length ? trapPack.why : '正在走的 K 只观察，收盘才确认。', core: false });
  }
  let bouncePack = null;
  let pullPack = null;
  if (factorOn('bounce') || factorOn('pull')) {
    const pb = getPb(voteSrc.length ? voteSrc : klines);
    const smcLive = factorOn('smc') ? ((getSmc(voteSrc.length ? voteSrc : klines) || {}).live) : null;
    const stealPb = (pack) => {
      if (!smcLive || smcLive.status !== 'trigger' || !pack || !pack.vote) return pack;
      if (pack.vote !== smcLive.dir) return pack;
      const near = Math.abs((pack.pbI || pack.recI || pack.extI || 0) - smcLive.i) <= 3;
      if (!near) return pack;
      return Object.assign({}, pack, {
        vote: 0,
        why: pack.why + '。同一段已记入 SMC 做多/做空信号，方向票不计。',
      });
    };
    const stealStack = (pack, kindNeed) => {
      if (!stackPack || !stackPack.vote || !pack || !pack.vote) return pack;
      if (pack.vote !== stackPack.vote) return pack;
      if (kindNeed && stackPack.kind !== kindNeed) return pack;
      return Object.assign({}, pack, {
        vote: 0,
        why: pack.why + '。同一段已记入' + (stackPack.title || '套轨') + '，方向票不计。',
      });
    };
    if (factorOn('bounce')) {
      bouncePack = stealStack(stealPb(pb.bounce), 'fade');
      const bName = bouncePack.dir < 0 ? '超涨回落' : '超跌反弹';
      factors.push({ id: 'bounce', name: bName, vote: voteSrc.length ? bouncePack.vote : 0, why: voteSrc.length ? bouncePack.why : '正在走的 K 只观察，收盘才确认。', core: false });
    }
    if (factorOn('pull')) {
      pullPack = stealStack(stealPb(pb.pull), 'pull');
      const pName = pullPack.dir < 0 ? '杀跌反抽' : '拉升回踩';
      factors.push({ id: 'pull', name: pName, vote: voteSrc.length ? pullPack.vote : 0, why: voteSrc.length ? pullPack.why : '正在走的 K 只观察，收盘才确认。', core: false });
    }
  }
  if (factorOn('fib')) {
    const fib = getFib(voteSrc.length ? voteSrc : klines);
    let fv = fib.vote;
    let fw = fib.why;
    if (fv && pullPack && pullPack.vote === fv) {
      fv = 0;
      fw = fw + '。同一段已记入回踩，斐波那契方向票不计。';
    } else if (fv && bouncePack && bouncePack.vote === fv) {
      fv = 0;
      fw = fw + '。同一段已记入反弹，斐波那契方向票不计。';
    } else if (fv && trapPack && trapPack.vote === fv) {
      fv = 0;
      fw = fw + '。同一段已记入诱空诱多，斐波那契方向票不计。';
    } else if (fv && srPack && srPack.vote === fv && fib.kind === 'fail') {
      fv = 0;
      fw = fw + '。同一段已记入支撑压力破位，斐波那契方向票不计。';
    }
    if (!voteSrc.length) { fv = 0; fw = '正在走的 K 只观察，收盘才确认。'; }
    factors.push({ id: 'fib', name: fib.name || '斐波那契', vote: fv, why: fw, core: false });
  }
  if (factorOn('hold')) {
    const hd = getHold(voteSrc.length ? voteSrc : klines);
    let hv = hd.vote;
    let hw = hd.why;
    if (hv && srPack && srPack.vote === hv && /影线/.test(srPack.why || '')) {
      hv = 0;
      hw = hw + '。同一段已记入支撑压力收回，企稳方向票不计。';
    } else if (hv && trapPack && trapPack.vote === hv) {
      hv = 0;
      hw = hw + '。同一段已记入诱空诱多，企稳方向票不计。';
    } else if (hv && bouncePack && bouncePack.vote === hv) {
      hv = 0;
      hw = hw + '。同一段已记入反弹，企稳方向票不计。';
    } else if (hv && pullPack && pullPack.vote === hv) {
      hv = 0;
      hw = hw + '。同一段已记入回踩，企稳方向票不计。';
    } else if (hv && factorOn('fib')) {
      const fibHold = getFib(klines);
      if (fibHold && fibHold.vote === hv && fibHold.kind === 'hold') {
        hv = 0;
        hw = hw + '。同一段已记入斐波那契收回，企稳方向票不计。';
      }
    }
    if (!voteSrc.length) { hv = 0; hw = '正在走的 K 只观察，收盘才确认。'; }
    const holdName = hd.dir < 0 ? '受阻' : '企稳';
    factors.push({ id: 'hold', name: holdName, vote: hv, why: hw, core: false });
  }

  const day = dayVote(ticker, last);
  if (factorOn('day') && day) factors.push({ id: 'day', name: mkt().hasSession ? '日内位置' : '24小时位置', vote: day.vote, why: day.why });

  if (factorOn('mtf')) {
    const mt = mtfVote(mtf, voteSrc.length ? voteSrc : klines);
    factors.push({ id: 'mtf', name: '多周期', vote: voteSrc.length ? mt.vote : 0, why: voteSrc.length ? mt.why : '正在走的 K 只观察，收盘才确认。', core: true });
  }

  if (!factors.length) {
    const closedMkt = !isMarketOpen(ticker);
    return {
      dir: closedMkt ? '休市' : '暂无',
      cls: 'chop',
      agree: '没有启用任何因子',
      hint: '左侧栏标题旁的下拉里可以勾选要用的判断因子。勾选只影响判断，不会开关主图指标。',
      audit: '请先勾选至少一项因子。',
      auditWarn: true,
      factors: [],
      r: r,
      a: e.a,
      b: e.b,
    };
  }

  const bull = factors.filter((f) => f.vote > 0).length;
  const bear = factors.filter((f) => f.vote < 0).length;
  const byFamily = { mom: [], struct: [], touch: [], pos: [] };
  factors.forEach((f) => {
    const fam = factorFamilyId(f);
    if (!byFamily[fam]) byFamily[fam] = [];
    byFamily[fam].push(f);
  });
  const families = [];
  let weightedNet = 0;
  let denom = 0;
  Object.keys(FAC_FAMILY_W).forEach((fid) => {
    const members = byFamily[fid] || [];
    if (!members.length) return;
    const picked = pickFamilyVote(members);
    const w = FAC_FAMILY_W[fid];
    denom += w;
    weightedNet += picked.vote * w;
    families.push({
      id: fid,
      name: FAC_FAMILY_LAB[fid] || fid,
      weight: w,
      vote: picked.vote,
      pick: picked.pick ? picked.pick.name : null,
    });
  });
  const ratio = denom > 0 ? weightedNet / denom : 0;
  const coreBull = families.some((f) => CORE_FAMILIES[f.id] && f.vote > 0);
  const coreBear = families.some((f) => CORE_FAMILIES[f.id] && f.vote < 0);
  let dir = '震荡';
  let cls = 'chop';
  let hint = '多空因子接近，更适合等待下一根确认，而不是追价。';
  let audit = '按族加权后多空接近或核心未齐，更适合等待下一根确认。';
  let auditWarn = false;
  const ratioTxt = (Math.round(Math.abs(ratio) * 100) / 100).toFixed(2);

  if (!isMarketOpen(ticker)) {
    dir = '休市';
    cls = 'chop';
    hint = '当前时段不可交易。以下为收盘前留下的结构，开盘后需要重新对齐。';
    audit = '时段外结构仅供参考，开盘后需要重新对齐。';
    auditWarn = true;
  } else if (ratio >= JUDGE_NET_RATIO && coreBull && !coreBear) {
    dir = '偏多';
    cls = 'bull';
    hint = '分族加权后偏多占优，且动量/结构核心没有对打。若要顺着看，优先等回踩均线，而不是去追当前最高价。';
    audit = '按族加权：加权多数 ' + ratioTxt + ' ≥ ' + JUDGE_NET_RATIO + '，核心与偏多同向。不是下单指令。';
  } else if (ratio <= -JUDGE_NET_RATIO && coreBear && !coreBull) {
    dir = '偏空';
    cls = 'bear';
    hint = '分族加权后偏空占优，且动量/结构核心没有对打。若要顺着看，优先等反弹到均线附近，而不是去追当前最低价。';
    audit = '按族加权：加权多数 ' + ratioTxt + ' ≥ ' + JUDGE_NET_RATIO + '，核心与偏空同向。不是下单指令。';
  } else if (Math.abs(ratio) >= JUDGE_NET_RATIO && coreBull && coreBear) {
    audit = '外围加权偏' + (ratio > 0 ? '多' : '空') + '，但动量/结构核心对打，不定向。';
    auditWarn = true;
  } else if (Math.abs(ratio) >= JUDGE_NET_RATIO && !coreBull && !coreBear) {
    audit = '加权方向来自触位或位置族，动量/结构核心还没表态，凑票定向不合理。';
    auditWarn = true;
  }

  if (factorOn('stack') && stackPack && stackPack.kind === 'conflict' && (dir === '偏多' || dir === '偏空')) {
    dir = '震荡';
    cls = 'chop';
    hint = '套轨四层不对齐，先等 1 小时与 15 分钟同向，而不是按均线凑票。';
    audit = '套轨大周期对打或错层，即使其他核心同向也不按偏多偏空处理。';
    auditWarn = true;
  }

  if (factorOn('rsi') && dir === '偏多' && r != null && r >= 70) {
    audit = 'RSI' + rsiN + ' 已进超买带，顺着偏多去追价的合理度低。';
    auditWarn = true;
  } else if (factorOn('rsi') && dir === '偏空' && r != null && r <= 30) {
    audit = 'RSI' + rsiN + ' 已进超卖带，顺着偏空去追价的合理度低。';
    auditWarn = true;
  } else if (dir === '偏多' && day && day.pos >= 0.85) {
    audit = '靠近今日高点，即使核心偏多也该等回踩，追高合理度低。';
    auditWarn = true;
  } else if (dir === '偏空' && day && day.pos <= 0.15) {
    audit = '靠近今日低点，即使核心偏空也该等反弹，追低合理度低。';
    auditWarn = true;
  }

  return {
    dir: dir,
    cls: cls,
    agree: bull + ' 项偏多，' + bear + ' 项偏空，共 ' + factors.length + ' 项',
    hint: hint,
    audit: audit,
    auditWarn: auditWarn,
    factors: factors,
    r: r,
    a: e.a,
    b: e.b,
  };
}
