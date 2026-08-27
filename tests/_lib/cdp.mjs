/**
 * headless Chrome + CDP 辅助。
 *
 * 用途：在真实浏览器里加载 gold-minute.html，通过 window.__goldTest 调用页面内部函数。
 * 这样做的好处是不必在 Node 里 mock DOM —— 页面怎么跑，测试就怎么跑。
 *
 * Chrome 路径可用 CHROME_PATH 覆盖。
 */

import { spawn } from 'node:child_process';

const DEFAULT_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export function chromePath() {
  return process.env.CHROME_PATH || DEFAULT_CHROME;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) { /* 尚未就绪 */ }
    await sleep(120);
  }
  throw new Error('CDP 未就绪: ' + url);
}

function attach(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => {
      resolve({
        ws,
        send(method, params = {}) {
          const i = ++id;
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              pending.delete(i);
              rej(new Error('CDP 超时: ' + method));
            }, 30000);
            pending.set(i, {
              res: (v) => { clearTimeout(timer); res(v); },
              rej: (e) => { clearTimeout(timer); rej(e); },
            });
            ws.send(JSON.stringify({ id: i, method, params }));
          });
        },
      });
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
        else p.res(msg.result);
      }
    });
  });
}

/** 启动本地 serve.js 并等到能响应，返回 { proc, port, origin }。 */
export async function startServer(port) {
  const p = port || 8899;
  const proc = spawn(process.execPath, ['serve.js'], {
    env: Object.assign({}, process.env, { PORT: String(p) }),
    stdio: 'ignore',
  });
  const origin = 'http://127.0.0.1:' + p;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(origin + '/gold-minute.html', { method: 'HEAD' });
      if (res.ok) return { proc, port: p, origin };
    } catch (e) { /* 尚未监听 */ }
    await sleep(100);
  }
  proc.kill();
  throw new Error('serve.js 未能在 8 秒内就绪，端口 ' + p);
}

/**
 * 打开页面并等 __goldTest 就绪。
 * 返回 { evalExpr, send, close }。
 */
export async function openPage(opts) {
  opts = opts || {};
  const port = opts.debugPort || 9331;
  const url = opts.url;
  if (!url) throw new Error('openPage 需要 url');

  const chrome = spawn(chromePath(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    `--remote-debugging-port=${port}`, '--window-size=1440,900', url,
  ], { stdio: 'ignore' });

  try {
    const pages = await waitJson(`http://127.0.0.1:${port}/json/list`);
    const page = pages.find((x) => x.type === 'page' && String(x.url || '').includes('gold-minute'))
      || pages.find((x) => x.type === 'page');
    if (!page) throw new Error('没有找到页面');
    const { send, ws } = await attach(page.webSocketDebuggerUrl);
    await send('Runtime.enable');
    await send('Page.enable');

    async function evalExpr(expression) {
      const r = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails));
      }
      return r.result && r.result.value;
    }

    // 等 __goldTest 挂上
    let ready = false;
    for (let i = 0; i < 60; i++) {
      ready = await evalExpr('!!(window.__goldTest && window.__goldTest.applyKlines)');
      if (ready) break;
      await sleep(250);
    }
    if (!ready) throw new Error('window.__goldTest.applyKlines 未就绪');

    return {
      evalExpr,
      send,
      close() {
        try { ws.close(); } catch (e) { /* 已关闭 */ }
        chrome.kill();
      },
    };
  } catch (err) {
    chrome.kill();
    throw err;
  }
}
