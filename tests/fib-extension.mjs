import { approx, assert } from './_lib/assert.mjs';
import { computeFib, fibExtensionPx, normalizeFibMode, selectFibWave } from '../src/indicators/fib.js';
import { state } from '../src/state.js';
import { KLINE_SCENARIOS, klinesFor } from './_baseline/scenarios.mjs';

approx(fibExtensionPx(100, 120, 1.272), 125.44, { label: 'up 1.272 extension' });
approx(fibExtensionPx(120, 100, 1.618), 87.64, { label: 'down 1.618 extension' });

const up = { dir: 1, score: 5, span: 20, B: { i: 20 } };
const down = { dir: -1, score: 7, span: 18, B: { i: 30 } };
assert(selectFibWave([up, down], 'auto') === down, 'auto selects highest score');
assert(selectFibWave([up, down], 'up') === up, 'up mode selects low-to-high leg');
assert(selectFibWave([up, down], 'down') === down, 'down mode selects high-to-low leg');

const oldUp = { dir: 1, score: -1, span: 30, B: { i: 10 } };
const recentUp = { dir: 1, score: -1, span: 12, B: { i: 40 } };
assert(selectFibWave([oldUp, recentUp], 'up') === recentUp, 'forced direction falls back to latest leg');
assert(selectFibWave([oldUp, recentUp], 'up').score < 0, 'direction fallback remains marked as visual only');
assert(selectFibWave([oldUp], 'auto') == null, 'auto preserves score filter');
assert(normalizeFibMode('bad') === 'auto', 'invalid mode normalizes to auto');

{
  const scenario = KLINE_SCENARIOS.find((x) => x.id === '1m-vol-low');
  state.tf = scenario.tf;
  state.fibMode = 'up';
  state.fibExt = true;
  const fib = computeFib(klinesFor(scenario));
  assert(fib.ok && fib.dir === 1, 'forced up mode draws a low-to-high reference');
  assert(fib.vote === 0 && /仅作画线参考/.test(fib.why), 'visual fallback does not vote');
  const ext = fib.levels.filter((x) => x.ext);
  assert(ext.length === 2, 'extension toggle adds two levels');
  assert(ext.every((x) => x.price > fib.end.price), 'up extensions project beyond the high endpoint');
}

console.log('PASS fib-extension');
