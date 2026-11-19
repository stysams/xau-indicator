import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../src/net/source.js', import.meta.url), 'utf8');
let serial = 0;
async function load(saved, broken = false) {
  let stored = saved, reloads = 0;
  globalThis.localStorage = {
    getItem() { if (broken) throw Error('denied'); return stored; },
    setItem(key, value) { if (broken) throw Error('denied'); assert.equal(key, 'gold-minute-api-host'); stored = value; },
  };
  globalThis.location = { reload() { reloads++; } };
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code + '\n//' + serial++).toString('base64'));
  return { mod, stored: () => stored, reloads: () => reloads };
}
for (const saved of [null, 'default', 'invalid', 'api.gateio.ws', 'www.gatenode.cash']) {
  const { mod } = await load(saved);
  const valid = ['api.gateio.ws', 'www.gatenode.cash'].includes(saved);
  assert.deepEqual(mod.apiSourceHeaders(), valid ? { 'X-Gate-API-Host': saved } : {});
}
{
  const session = await load('api.gateio.ws');
  let change;
  const select = { value: '', addEventListener(event, callback) { assert.equal(event, 'change'); change = callback; } };
  session.mod.bindApiSource(select, assert.fail);
  assert.equal(select.value, 'api.gateio.ws');
  change();
  assert.equal(session.reloads(), 0);
  select.value = 'www.gatenode.cash';
  change();
  assert.equal(session.stored(), 'www.gatenode.cash');
  assert.equal(session.reloads(), 1);
  // The old document keeps its source until reload, avoiding mixed in-flight requests.
  assert.deepEqual(session.mod.apiSourceHeaders(), { 'X-Gate-API-Host': 'api.gateio.ws' });
  const next = await load(session.stored());
  assert.deepEqual(next.mod.apiSourceHeaders(), { 'X-Gate-API-Host': 'www.gatenode.cash' });
}
{
  const session = await load(null, true);
  let change, message;
  const select = { addEventListener(_, fn) { change = fn; } };
  session.mod.bindApiSource(select, (text) => { message = text; });
  select.value = 'www.gatenode.cash';
  change();
  assert.equal(select.value, 'default');
  assert.match(message, /无法保存/);
  assert.equal(session.reloads(), 0);
}
// All REST consumers use the selected host without changing paths or query strings.
await load('www.gatenode.cash');
const { getJson } = await import('../src/net/rest.js');
globalThis.fetch = async (url, options) => {
  assert.equal(url, '/api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=1m');
  assert.equal(options.headers['X-Gate-API-Host'], 'www.gatenode.cash');
  return { ok: true, status: 200, json: async () => [{ t: 1, c: '10' }] };
};
assert.deepEqual(await getJson('/api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=1m'), [{ t: 1, c: '10' }]);
console.log('PASS per-browser API source selection, reload, storage failure and REST headers');
