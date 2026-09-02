import { assert } from './_lib/assert.mjs';

globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.document = {
  getElementById() { return null; },
  querySelectorAll() { return []; },
  documentElement: { style: { setProperty() {} } },
};

const { QUOTE_MTF_TFS } = await import('../src/view/panels.js');
const ids = QUOTE_MTF_TFS.map((x) => x.id);

assert(ids.join(',') === '1m,15m,1h,1d', 'quote MTF shows 1m, 15m, 1h and 1d');
assert(!ids.includes('5m'), 'quote MTF no longer shows 5m');
assert(QUOTE_MTF_TFS[3].name === '1日', 'daily quote label is 1日');

console.log('PASS quote-mtf');
