import { randomWalkOHLC } from './_lib/rw.mjs';
import { computeHkldChart, computeHkldHtf } from '../src/indicators/hkld.js';
import { state } from '../src/state.js';
import { assert } from './_lib/assert.mjs';

state.mkt = 'xau';
state.tf = '1m';
state.bollN = 20;
state.bollK = 2;
state.rsiN = 14;

function stamp(bars, span, lastAge) {
  const lastT = Math.floor(Date.now() / 1000) - lastAge;
  return bars.map((b, i) => Object.assign({}, b, {
    t: lastT - (bars.length - 1 - i) * span,
  }));
}

// 高周期最后一根尚未收盘时，HKLD 只能观察，不能给正式方向票。
{
  let changed = 0;
  for (let seed = 1; seed <= 160; seed++) {
    const chart = stamp(randomWalkOHLC({ n: 180, seed: seed, vol: 0.45 }), 60, 70);
    const src5 = stamp(randomWalkOHLC({ n: 120, seed: seed + 10000, vol: 0.90 }), 300, 30);
    const src15 = stamp(randomWalkOHLC({ n: 90, seed: seed + 20000, vol: 1.60 }), 900, 30);
    const pack = computeHkldHtf(chart, src5, src15);
    assert(pack.forming, '高周期未收盘应标记 forming @' + seed);
    assert(pack.vote === 0, '高周期未收盘不得出票 @' + seed + ': ' + JSON.stringify(pack));
    if (pack.status === 'watch') changed++;
  }
  assert(changed > 0, '应覆盖至少一个高周期预备状态');
}

// 单周期连续贴轨属于趋势延伸，即使出现收回痕迹也不得升级为正式回归票。
{
  let blocked = 0;
  for (let seed = 1; seed <= 160; seed++) {
    const bars = randomWalkOHLC({ n: 180, seed: seed + 30000, vol: 0.30, drift: 0.12 });
    const pack = computeHkldChart(bars);
    if (pack.status === 'block') blocked++;
    assert(!(pack.kind === 'fade' && pack.status === 'trigger'),
      '强趋势贴轨不应产生回归正式票 @' + seed + ': ' + JSON.stringify(pack));
  }
  assert(blocked > 0, '强趋势样本应覆盖贴轨阻断状态');
}

console.log('PASS hkld-confidence');
