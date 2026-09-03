import { assert } from './_lib/assert.mjs';
import {
  CHART_MAGNIFY_MAX, CHART_MAGNIFY_MIN, candleBodyWidth, normalizeChartMagnify, priceOffsetForDrag,
  priceRangeForMagnify,
} from '../src/view/viewport.js';
import { normalizeUsidxPaneHeight } from '../src/view/osc.js';

assert(normalizeChartMagnify(1.04) === 1, 'magnification rounds to stable tenths');
assert(normalizeChartMagnify(1.26) === 1.3, 'magnification rounds upward to a tenth');
assert(normalizeChartMagnify(0.1) === CHART_MAGNIFY_MIN, 'magnification clamps at lower bound');
assert(normalizeChartMagnify(9) === CHART_MAGNIFY_MAX, 'magnification clamps at upper bound');
assert(normalizeChartMagnify('bad') === 1, 'invalid magnification returns to 100%');
assert(priceOffsetForDrag(0, 50, 200, 40) === 10, 'dragging down shifts the price window upward so candles move down');
assert(priceOffsetForDrag(5, -25, 200, 40) === 0, 'dragging up shifts the price window downward so candles move up');
assert(priceOffsetForDrag(7, 20, 0, 40) === 7, 'invalid plot height preserves the current price offset');
const tight = priceRangeForMagnify(100, 200, 1.6);
assert(Math.abs(tight.lo - 118.75) < 1e-9 && Math.abs(tight.hi - 181.25) < 1e-9, 'higher magnification narrows the price range around its center');
const wide = priceRangeForMagnify(100, 200, 0.7);
assert(Math.abs(wide.lo - 78.5714285714) < 1e-9 && Math.abs(wide.hi - 221.4285714286) < 1e-9, 'lower magnification widens the price range around its center');
const invalidRange = priceRangeForMagnify(200, 100, 1.2);
assert(invalidRange.lo === 200 && invalidRange.hi === 100, 'invalid price range is preserved');
assert(normalizeUsidxPaneHeight(24) === 48, 'USIDX pane height has a usable minimum');
assert(normalizeUsidxPaneHeight(240) === 160, 'USIDX pane height has a bounded maximum');
assert(candleBodyWidth(10) === 5.8, 'normal candle body leaves visible space between slots');
assert(candleBodyWidth(40) === 14, 'deep wheel zoom keeps candle bodies slender');
assert(candleBodyWidth(0.5) === 0.7, 'dense candles retain a visible minimum width');

console.log('PASS chart-magnify');
