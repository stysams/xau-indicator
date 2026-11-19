'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
function config(host) {
  const context = { process: { env: host === undefined ? {} : { GATE_API_HOST: host } }, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'gate-api.js'), 'utf8'), context);
  return context.module.exports;
}
assert.equal(config().API_HOST, 'api.gateio.ws');
assert.equal(config('www.gatenode.cash').API_HOST, 'www.gatenode.cash');
for (const host of ['', 'https://www.gatenode.cash/', 'host:443', 'host/path', 'host?x', '-host.com', 'a..com', ' host.com', 'a'.repeat(64) + '.com']) {
  assert.throws(() => config(host), /GATE_API_HOST/);
}
async function check(entry, host, mode, selected, futures = false) {
  let handler, options, request, output;
  const dependencies = {
    './gate-api': config(host),
    https: { get(opts, callback) {
      options = opts;
      request = new EventEmitter();
      request.destroy = (err) => request.emit('error', err);
      queueMicrotask(() => {
        if (mode === 'timeout') return request.emit('timeout');
        const response = new EventEmitter();
        response.statusCode = mode === 'rate' ? 429 : 200;
        callback(response);
        response.emit('data', Buffer.from(mode === 'html' ? '<script>verify()</script>' : '{"ok":true}'));
        response.emit('end');
      });
      return request;
    } },
    http: { createServer(fn) { handler = fn; return { on() {}, listen() {} }; } },
    readline: { createInterface() { return { on(event, fn) { handler = fn; } }; } },
  };
  const context = {
    require: (name) => dependencies[name] || require(name),
    __dirname: root, Buffer, URL,
    process: { env: {}, stdin: {}, stderr: { write() {} }, stdout: { write(data) { output = JSON.parse(data); } } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, entry), 'utf8'), context);
  const requestPath = futures ? '/api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=1m&limit=42' : '/api/v4/tradfi/symbols/XAUUSD/klines?kline_type=5m&limit=42';
  if (entry === 'serve.js') {
    handler({ method: 'GET', url: requestPath, headers: selected === undefined ? {} : { 'x-gate-api-host': selected } }, {
      writeHead(status) { output = { status }; },
      end(body) { output.body = JSON.parse(body.toString()); },
    });
  } else {
    await handler(JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'gate_cfd_get_klines', arguments: { symbol: 'XAUUSD', kline_type: '5m', limit: 42 } } }));
  }
  await new Promise(setImmediate);
  if (selected && !['api.gateio.ws', 'www.gatenode.cash'].includes(selected)) {
    assert.equal(options, undefined);
    assert.equal(output.status, 400);
    assert.equal(output.body.label, 'INVALID_API_HOST');
    return;
  }
  assert.equal(options.host, selected || host || 'api.gateio.ws');
  assert.equal(options.path, requestPath);
  assert.equal(options.timeout, 15000);
  if (mode === 'html' || mode === 'timeout') {
    const error = entry === 'serve.js' ? output.body.message : output.result.content[0].text;
    if (mode === 'html') assert.ok(error.includes(selected || host || 'api.gateio.ws'));
    assert.match(error, mode === 'html' ? /非 JSON.*网站验证/ : /超时/);
    if (entry === 'serve.js') assert.equal(output.status, 502);
    else assert.equal(output.result.isError, true);
  } else if (entry === 'serve.js') {
    assert.equal(output.status, mode === 'rate' ? 429 : 200);
    assert.equal(output.body.ok, true);
  } else assert.equal(JSON.parse(output.result.content[0].text).ok, true);
}
(async () => {
  for (const entry of ['serve.js', 'server.js']) {
    for (const host of [undefined, 'www.gatenode.cash']) {
      for (const mode of ['json', 'html', 'timeout', 'rate']) await check(entry, host, mode);
    }
  }
  for (const selected of ['api.gateio.ws', 'www.gatenode.cash', 'localhost', 'https://www.gatenode.cash/', ['api.gateio.ws']]) {
    for (const mode of ['json', 'html', 'timeout']) {
      await check('serve.js', 'custom.example.com', mode, selected, true);
    }
  }
  console.log('PASS Gate REST configuration, proxy/MCP requests and upstream errors');
})().catch((error) => { console.error(error); process.exitCode = 1; });
