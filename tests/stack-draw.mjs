import { assert } from './_lib/assert.mjs';

let saved = JSON.stringify({
  stack: true,
  stackDraw: { '1m': false, '5m': 'invalid', signal: false },
});

const attrs = {};
const buttons = ['1m', '5m', '15m', '1h', 'signal'].map((key) => ({
  dataset: { stackDraw: key },
  setAttribute(name, value) { attrs[key + ':' + name] = value; },
}));
const stackDrawBar = { hidden: true };
const stackBar = { hidden: true };

globalThis.localStorage = {
  getItem() { return saved; },
  setItem(key, value) { saved = value; },
};
globalThis.document = {
  getElementById(id) {
    if (id === 'stackDrawBar') return stackDrawBar;
    if (id === 'stackBar') return stackBar;
    return null;
  },
  querySelectorAll(selector) {
    return selector === 'button[data-stack-draw]' ? buttons : [];
  },
  documentElement: { style: { setProperty() {} } },
};

const [{ loadInd, saveInd, syncIndButtons }, { state }] = await Promise.all([
  import('../src/ui/indicator-menu.js'),
  import('../src/state.js'),
]);

assert(Object.values(state.stackDraw).every(Boolean), 'stack drawings default to on');

loadInd();
assert(state.ind.stack, 'saved stack master switch loads');
assert(state.stackDraw['1m'] === false, 'saved 1m drawing switch loads');
assert(state.stackDraw.signal === false, 'saved signal drawing switch loads');
assert(state.stackDraw['5m'] === true, 'invalid saved drawing switch keeps default');

syncIndButtons();
assert(!stackDrawBar.hidden, 'drawing controls show with stack enabled');
assert(!stackBar.hidden, 'stack card shows with stack enabled');
assert(attrs['1m:aria-pressed'] === 'false', 'disabled drawing button syncs');
assert(attrs['5m:aria-pressed'] === 'true', 'enabled drawing button syncs');

state.ind.stack = false;
syncIndButtons();
assert(stackDrawBar.hidden, 'drawing controls hide with stack disabled');
assert(stackBar.hidden, 'stack card hides with stack disabled');

state.stackDraw['15m'] = false;
saveInd();
const persisted = JSON.parse(saved);
assert(persisted.stackDraw['15m'] === false, 'drawing switches persist');
assert(persisted.stackDraw['1h'] === true, 'enabled drawing switches persist');

console.log('PASS stack-draw');
