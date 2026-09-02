import { assert } from './_lib/assert.mjs';
import {
  CHART_MAGNIFY_MAX, CHART_MAGNIFY_MIN, candleBodyWidth, normalizeChartMagnify, priceOffsetForDrag,
} from '../src/view/viewport.js';

assert(normalizeChartMagnify(1.04) === 1, 'magnification rounds to stable tenths');
assert(normalizeChartMagnify(1.26) === 1.3, 'magnification rounds upward to a tenth');
assert(normalizeChartMagnify(0.1) === CHART_MAGNIFY_MIN, 'magnification clamps at lower bound');
assert(normalizeChartMagnify(9) === CHART_MAGNIFY_MAX, 'magnification clamps at upper bound');
assert(normalizeChartMagnify('bad') === 1, 'invalid magnification returns to 100%');
assert(priceOffsetForDrag(0, 50, 200, 40) === 10, 'dragging down shifts the price window upward so candles move down');
assert(priceOffsetForDrag(5, -25, 200, 40) === 0, 'dragging up shifts the price window downward so candles move up');
assert(priceOffsetForDrag(7, 20, 0, 40) === 7, 'invalid plot height preserves the current price offset');
assert(candleBodyWidth(10) === 5.8, 'normal candle body leaves visible space between slots');
assert(candleBodyWidth(40) === 14, 'deep wheel zoom keeps candle bodies slender');
assert(candleBodyWidth(0.5) === 0.7, 'dense candles retain a visible minimum width');

console.log('PASS chart-magnify');
