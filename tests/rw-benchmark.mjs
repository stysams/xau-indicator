import { computeHs } from '../src/indicators/hs.js';
import { computeSmc } from '../src/indicators/smc.js';
import { randomWalkOHLC } from './_lib/rw.mjs';
import { assert } from './_lib/assert.mjs';

const N = Math.max(1, parseInt(process.env.RW_N || '200', 10) || 200);
const BARS = 180;

function mean(xs) {
  if (!xs.length) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

let hsHits = 0;
const obCont = [];
const obGap = [];
const hsStatus = { forming: 0, confirmed: 0, failed: 0, none: 0 };

for (let s = 1; s <= N; s++) {
  const cont = randomWalkOHLC({ n: BARS, seed: s, mode: 'cont' });
  const gap = randomWalkOHLC({ n: BARS, seed: s, mode: 'gap', gapNoise: 0.02 });

  const hs = computeHs(cont);
  if (hs.patterns && hs.patterns.length) {
    hsHits += 1;
    const st = hs.patterns[0].status || 'forming';
    if (hsStatus[st] != null) hsStatus[st] += 1;
    else hsStatus.forming += 1;
  } else {
    hsStatus.none += 1;
  }

  obCont.push(computeSmc(cont).obs.length);
  obGap.push(computeSmc(gap).obs.length);
}

const hsRate = hsHits / N;
const meanCont = mean(obCont);
const meanGap = mean(obGap);
const maxCont = Math.max.apply(null, obCont);
const maxGap = Math.max.apply(null, obGap);

const report = {
  N: N,
  bars: BARS,
  hsHitRate: Number(hsRate.toFixed(4)),
  hsHits: hsHits,
  hsStatus: hsStatus,
  obContMean: Number(meanCont.toFixed(4)),
  obGapMean: Number(meanGap.toFixed(4)),
  obContMax: maxCont,
  obGapMax: maxGap,
  note: 'A2 已修：cont 上未回补 OB 不再要求恒为 0；弱断言 gap 均值 > cont 或 gap 均值合理',
};

console.log(JSON.stringify(report, null, 2));

// 头肩在纯噪声上通常高命中；给宽松上下界，防止抽取/加载静默失败
assert(hsRate >= 0.15, 'HS hit rate too low on noise: ' + hsRate + ' (extract/load may be broken)');
assert(hsRate <= 0.98, 'HS hit rate absurdly high: ' + hsRate);

// OB：gap 应能恢复未回补订单块；cont 可能因 A2 修复后也有少量存活
const gapOk = meanGap >= 0.05 || maxGap >= 1;
assert(gapOk, 'gap OB not recovering: mean=' + meanGap + ' max=' + maxGap);

const relationOk = meanGap > meanCont || meanGap >= 0.2;
assert(relationOk, 'expected gap OB > cont OB (or gap mean >= 0.2); cont=' + meanCont + ' gap=' + meanGap);

console.log('PASS rw-benchmark');
