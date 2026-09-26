// 收盘确认口径回归：2026-09 审计修复的四类问题
// 1) 破位/颈线扫描必须包含最新已收盘 K（此前 judge 传已收盘序列时票晚一根）
// 2) 布林带宽分位窗口按序列自身周期取，套轨跨层不受当前图周期污染
// 3) 超级趋势/箱体的状态与翻转只认已收盘 K，未收盘只标预备
// 4) DXY 对照按时间戳对齐，数据源错峰时不比较不同时间窗
import { srBreakMeta, srLevelZone } from '../src/indicators/sr.js';
import { hsScanBreak } from '../src/indicators/hs.js';
import { analyzeBoll } from '../src/indicators/boll.js';
import { stackLayer } from '../src/indicators/stack.js';
import { computeSuperTrend } from '../src/indicators/supertrend.js';
import { computeBox } from '../src/indicators/box.js';
import { dxyVote } from '../src/judge/votes.js';
import { state } from '../src/state.js';
import { assert } from './_lib/assert.mjs';

function bar(t, o, h, l, c) { return { t, o, h, l, c }; }

const T0 = 1_700_000_000; // 固定过去时刻 → 全部视为已收盘

// 取一个剩余时间充足（>1s）的未收盘桶起点；若恰逢桶尾就等到下一桶
async function formingBucketStart(spanSec) {
  let t = Math.floor(Date.now() / 1000 / spanSec) * spanSec;
  if (Date.now() >= t * 1000 + spanSec * 1000 - 1000) {
    await new Promise((r) => setTimeout(r, 1200));
    t = Math.floor(Date.now() / 1000 / spanSec) * spanSec;
  }
  return t;
}

const oldTf = state.tf;
state.tf = '1m';

try {
  // --- 1a. srBreakMeta：已收盘序列的最后一根破位必须被识别 ---
  {
    const kl = [];
    for (let i = 0; i < 28; i++) {
      const o = 100 + (i % 2) * 0.2;
      kl.push(bar(T0 + i * 60, o, o + 0.3, o - 0.3, o - 0.1));
    }
    const cluster = {
      price: 100, spread: 0.2, firstI: 0, lastI: 20,
      pivots: [{ i: 5, kind: 'l', price: 99.9 }, { i: 12, kind: 'l', price: 100.1 }, { i: 20, kind: 'l', price: 100 }],
      hN: 0, lN: 3, orig: 'sup', lastRole: 'sup',
    };
    const zone = srLevelZone(cluster, 0.5);
    const thresh = 0.3;
    const closed = kl.concat([
      bar(T0 + 28 * 60, 100, 100.2, 99.8, 100.1),
      bar(T0 + 29 * 60, 100.1, 100.2, 97, 97.2),
    ]);
    const r1 = srBreakMeta(closed, cluster, zone, thresh);
    assert(r1.breakI === 29 && r1.breakDir === -1, '最后一根已收盘 K 的破位应被识别: breakI=' + r1.breakI);

    // 未收盘 K 的破位不算数
    const tForm = await formingBucketStart(60);
    const live = kl.concat([
      bar(T0 + 28 * 60, 100, 100.2, 99.8, 100.1),
      bar(tForm, 100.1, 100.2, 97, 97.2),
    ]);
    const r2 = srBreakMeta(live, cluster, zone, thresh);
    assert(r2.breakI == null, '未收盘 K 的破位不应记入: breakI=' + r2.breakI);
  }

  // --- 1b. hsScanBreak：已收盘序列的最后一根破颈线必须被识别 ---
  {
    const kl = [];
    for (let i = 0; i < 28; i++) {
      const o = 101.5 + (i % 2) * 0.1;
      kl.push(bar(T0 + i * 60, o, o + 0.2, o - 0.2, o - 0.05));
    }
    const t1 = { i: 2, kind: 'l', price: 100.0 };
    const t2 = { i: 20, kind: 'l', price: 100.2 };
    const rs = { i: 24, kind: 'h', price: 102.0 };
    const head = { i: 11, kind: 'h', price: 104.0 };
    const closed = kl.concat([
      bar(T0 + 28 * 60, 101.4, 101.5, 100.5, 100.6),
      bar(T0 + 29 * 60, 100.5, 100.6, 99.0, 99.2),
    ]);
    const r1 = hsScanBreak(closed, t1, t2, rs, head, 'top');
    assert(r1.breakI === 29, '最后一根已收盘 K 破颈线应被识别: breakI=' + r1.breakI);

    const tForm = await formingBucketStart(60);
    const live = kl.concat([
      bar(T0 + 28 * 60, 101.4, 101.5, 100.5, 100.6),
      bar(tForm, 100.5, 100.6, 99.0, 99.2),
    ]);
    const r2 = hsScanBreak(live, t1, t2, rs, head, 'top');
    assert(r2.breakI == null, '未收盘 K 破颈线不应记入: breakI=' + r2.breakI);
  }

  // --- 2. analyzeBoll 带宽分位窗口按传入周期取，stackLayer 不随图周期漂移 ---
  {
    const kl = [];
    let px = 100;
    for (let i = 0; i < 130; i++) {
      const amp = i < 100 ? 0.15 : 0.8;
      const o = px;
      px += (i % 2 ? 1 : -1) * amp * (0.5 + ((i * 37) % 11) / 20);
      const c = px;
      kl.push(bar(T0 + i * 60, o, Math.max(o, c) + 0.05, Math.min(o, c) - 0.05, c));
    }
    const r1m = analyzeBoll(kl, '1m').bwRank;
    const r1h = analyzeBoll(kl, '1h').bwRank;
    assert(r1m != null && r1h != null, 'bwRank 应可计算');
    assert(r1m !== r1h, '不同周期窗口应给出不同分位: ' + r1m + ' vs ' + r1h);

    state.tf = '1h';
    const rExplicit = analyzeBoll(kl, '1m').bwRank;
    assert(rExplicit === r1m, '显式传周期时不应受 state.tf 影响');

    state.tf = '1m';
    const layerA = stackLayer(kl, { id: '1h', name: '1小时' });
    state.tf = '1h';
    const layerB = stackLayer(kl, { id: '1h', name: '1小时' });
    assert(layerA.bwRank === layerB.bwRank && layerA.id === layerB.id,
      'stackLayer 1小时层的带宽分位不应随当前图周期漂移');
    state.tf = '1m';
  }

  // --- 3a. 超级趋势：未收盘 K 不换向，只标预备；收盘后确认 ---
  {
    const kl = [];
    for (let i = 0; i < 40; i++) {
      const c = 105 - i * 0.08;
      kl.push(bar(T0 + i * 60, c + 0.1, c + 0.25, c - 0.25, c));
    }
    assert(computeSuperTrend(kl).lastDir === -1, '下行段 lastDir 应为 -1');

    const spike = { o: 101.9, h: 104.5, l: 101.8, c: 104.4 };
    const tForm = await formingBucketStart(60);
    const live = computeSuperTrend(kl.concat([bar(tForm, spike.o, spike.h, spike.l, spike.c)]));
    assert(live.lastDir === -1 && live.status === 'down', '未收盘 K 的穿越不应换向: lastDir=' + live.lastDir);
    assert(!live.flips.some((f) => f.i === kl.length), '翻转序列不应包含未收盘那根');
    assert(/收盘确认/.test(live.why), 'why 应提示等收盘确认: ' + live.why);

    const closed = computeSuperTrend(kl.concat([bar(T0 + 40 * 60, spike.o, spike.h, spike.l, spike.c)]));
    assert(closed.lastDir === 1 && closed.flips.some((f) => f.i === kl.length), '同一根收盘后应确认换向');
  }

  // --- 3b. 箱体：未收盘 K 越过边缘只标预备；收盘越线才记破位 ---
  {
    const kl = [];
    for (let i = 0; i < 60; i++) {
      const ph = i % 10 < 5 ? 1 : -1;
      const o = 100 + (i % 2) * 0.1;
      const h = o + (ph > 0 ? 0.45 : 0.1);
      const l = o - (ph > 0 ? 0.1 : 0.45);
      const c = ph > 0 ? o + 0.4 : o - 0.4;
      kl.push(bar(T0 + i * 60, o, h, l, c));
    }
    const p0 = computeBox(kl);
    assert(p0.ok && p0.status === 'range', '基准箱体应成立: ' + p0.why);

    const spikeClose = p0.top + p0.breakout + 0.4;
    const tForm = await formingBucketStart(60);
    const live = computeBox(kl.concat([bar(tForm, kl[59].c, spikeClose + 0.1, kl[59].c - 0.1, spikeClose)]));
    assert(live.status === 'range' && live.dir === 0, '未收盘越线不应记破位: ' + live.status);
    assert(live.target == null && live.breakI === -1, '未收盘越线不应有量度目标/破位起点');
    assert(/未收盘 K 已越过上沿/.test(live.why), 'why 应提示等收盘确认: ' + live.why);

    const closed = computeBox(kl.concat([bar(T0 + 60 * 60, kl[59].c, spikeClose + 0.1, kl[59].c - 0.1, spikeClose)]));
    assert(closed.status === 'breakUp' && closed.target != null, '收盘越线应记上破并给出目标: ' + closed.status);
  }

  // --- 4. dxyVote：时间戳对齐；错峰数据不给假票 ---
  {
    const gold = [];
    const dxy = [];
    for (let i = 0; i < 6; i++) {
      const g = 100 + i;
      const d = 100 - i * 0.5;
      gold.push(bar(1000 + i * 60, g, g, g, g));
      dxy.push(bar(1000 + i * 60, d, d, d, d));
    }
    const ok = dxyVote(gold, dxy);
    assert(ok.vote === 1, '同步负相关应给多票: ' + ok.vote + ' ' + ok.why);

    const stale = dxy.map((b) => bar(b.t + 60, b.o, b.h, b.l, b.c));
    const bad = dxyVote(gold, stale);
    assert(bad.vote === 0 && /同步/.test(bad.why), '错峰数据不应比较不同时间窗: ' + bad.why);
  }
} finally {
  state.tf = oldTf;
}
console.log('PASS closed-confirm');
