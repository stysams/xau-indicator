import { assert } from './_lib/assert.mjs';

const attrs = {};
const guide = {
  setAttribute(name, value) { attrs[name] = value; },
};

globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.document = {
  getElementById(id) { return id === 'ck-sig-guide' ? guide : null; },
  querySelectorAll() { return []; },
  documentElement: { style: { setProperty() {} } },
};

const { syncSigGuide } = await import('../src/view/signal-rail.js');

syncSigGuide({ x: 245.5, y: 382 });
assert(attrs.x1 === '245.5' && attrs.x2 === '245.5', 'signal guide aligns to hovered point');
assert(attrs.y1 === '14' && attrs.y2 === '382', 'signal guide connects chart top to signal point');
assert(attrs.visibility === 'visible', 'signal guide shows on hover');

syncSigGuide(null);
assert(attrs.visibility === 'hidden', 'signal guide hides after hover');

console.log('PASS signal-guide');
