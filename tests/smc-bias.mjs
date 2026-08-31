import { computeSmc, smcPoiHold } from '../src/indicators/smc.js';
import { state } from '../src/state.js';
import { randomWalkOHLC } from './_lib/rw.mjs';
import { assert } from './_lib/assert.mjs';

const poi = { top: 101, bot: 100 };
assert(smcPoiHold(1, { c: 100.2 }, poi), 'long POI hold accepts lower in-zone close');
assert(!smcPoiHold(1, { c: 101.01 }, poi), 'long POI hold rejects close above POI');
assert(smcPoiHold(-1, { c: 100.8 }, poi), 'short POI hold accepts upper in-zone close');
assert(!smcPoiHold(-1, { c: 99.99 }, poi), 'short POI hold rejects close below POI');

const oldTf = state.tf;
state.tf = '1m';
const closed = randomWalkOHLC({ n: 180, seed: 37, t0: 1_700_000_000, step: 60 });
const forming = closed.concat([{
  t: Math.floor(Date.now() / 1000) + 60,
  o: closed[closed.length - 1].c,
  h: closed[closed.length - 1].c + 20,
  l: closed[closed.length - 1].c - 20,
  c: closed[closed.length - 1].c + 15,
}]);
const baseline = computeSmc(closed);
const withForming = computeSmc(forming);
assert(JSON.stringify(withForming) === JSON.stringify(baseline), 'forming bar must not affect SMC structure');
state.tf = oldTf;

console.log('PASS smc-bias');
