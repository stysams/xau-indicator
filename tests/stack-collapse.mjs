import { assert } from './_lib/assert.mjs';

const classes = new Set();
const stackEl = {
  hidden: true,
  innerHTML: '',
  classList: {
    toggle(name, on) {
      if (on) classes.add(name);
      else classes.delete(name);
    },
  },
};

globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.document = {
  getElementById(id) { return id === 'stackBar' ? stackEl : null; },
  querySelectorAll() { return []; },
  documentElement: { style: { setProperty() {} } },
};

const [{ renderStackBar }, { state }] = await Promise.all([
  import('../src/view/panels.js'),
  import('../src/state.js'),
]);

state.ind.stack = true;
state.stackCollapsed = false;
renderStackBar();
assert(stackEl.innerHTML.includes('data-stack-fold'), 'expanded stack card has fold button');
assert(stackEl.innerHTML.includes('stack-row'), 'expanded stack card has timeframe rows');
assert(!classes.has('is-collapsed'), 'expanded stack card has no collapsed class');

state.stackCollapsed = true;
renderStackBar();
assert(stackEl.innerHTML.includes('stack-compact'), 'collapsed stack card has compact summary');
assert(!stackEl.innerHTML.includes('stack-row'), 'collapsed stack card hides timeframe rows');
assert(classes.has('is-collapsed'), 'collapsed stack card has collapsed class');

state._stackKey = '';
renderStackBar();
assert(stackEl.innerHTML.includes('stack-compact'), 'live refresh preserves collapsed template');

console.log('PASS stack-collapse');
