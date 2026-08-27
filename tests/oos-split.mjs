import { computeHs } from '../src/indicators/hs.js';
import { computeSmc } from '../src/indicators/smc.js';
import { randomWalkOHLC } from './_lib/rw.mjs';
import { assert } from './_lib/assert.mjs';

const N = Math.max(1, parseInt(process.env.RW_N || '200', 10) || 200);
const BARS = 180;
// 两段不重叠种子：训练/标定 1..N，样本外 1_000_001 .. 1_000_000+N
const SEED_A0 = 1;
const SEED_B0 = 1_000_001;

function evalSplit(seed0, label) {
  let hsHits = 0;
  let obSum = 0;
  let firstC = null;
  for (let i = 0; i < N; i++) {
    const seed = seed0 + i;
    const bars = randomWalkOHLC({ n: BARS, seed: seed, mode: 'cont' });
    if (i === 0) firstC = bars[0].c;
    const hs = computeHs(bars);
    if (hs.patterns && hs.patterns.length) hsHits += 1;
    obSum += computeSmc(bars).obs.length;
  }
  return {
    label: label,
    seedStart: seed0,
    seedEnd: seed0 + N - 1,
    N: N,
    firstClose: firstC,
    hsHitRate: hsHits / N,
    hsHits: hsHits,
    obMean: obSum / N,
  };
}

const a = evalSplit(SEED_A0, 'in-sample-seeds');
const b = evalSplit(SEED_B0, 'oos-seeds');

// 种子区间不重叠
assert(a.seedEnd < b.seedStart, 'seed ranges overlap');

// 两段序列起点不同（同 start 价但不同种子下后续路径不同；用第 2 根收盘交叉核对）
const sampleA = randomWalkOHLC({ n: BARS, seed: SEED_A0, mode: 'cont' });
const sampleB = randomWalkOHLC({ n: BARS, seed: SEED_B0, mode: 'cont' });
assert(sampleA[10].c !== sampleB[10].c || sampleA[50].c !== sampleB[50].c, 'OOS series not distinct');

const report = {
  A: {
    label: a.label,
    seeds: [a.seedStart, a.seedEnd],
    hsHitRate: Number(a.hsHitRate.toFixed(4)),
    obMean: Number(a.obMean.toFixed(4)),
  },
  B: {
    label: b.label,
    seeds: [b.seedStart, b.seedEnd],
    hsHitRate: Number(b.hsHitRate.toFixed(4)),
    obMean: Number(b.obMean.toFixed(4)),
  },
  deltaHs: Number((b.hsHitRate - a.hsHitRate).toFixed(4)),
  note: '双段不重叠种子；报告两侧 HS 命中率与 OB 均值，供参数改动前后对照',
};

console.log(JSON.stringify(report, null, 2));

// 两侧都应能跑出有效统计（防止加载失败导致双 0）
assert(a.hsHitRate > 0 || b.hsHitRate > 0, 'both splits produced zero HS hits');
assert(a.hsHitRate >= 0.1 && b.hsHitRate >= 0.1, 'HS rate unexpectedly low on a split');

console.log('PASS oos-split');
