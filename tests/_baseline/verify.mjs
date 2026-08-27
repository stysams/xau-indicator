/**
 * 回放基线快照并比对。拆分 gold-minute.html 之后跑。
 *
 *   node tests/_baseline/verify.mjs
 *
 * 任何差异都视为失败 —— 拆分是纯搬运，输出应当逐位相同。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage } from '../_lib/cdp.mjs';
import { collectAll } from './collect.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(dir, 'snapshot.json');
const MAX_REPORT = 25;

function fmt(v) {
  if (v === undefined) return '(缺失)';
  if (v === null) return 'null';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
  }
  return JSON.stringify(v);
}

function diff(a, b, at, out) {
  if (out.length >= MAX_REPORT) return out;

  if (a === b) return out;

  const ta = a === null ? 'null' : typeof a;
  const tb = b === null ? 'null' : typeof b;
  if (ta !== tb) {
    out.push({ at, base: fmt(a), now: fmt(b) });
    return out;
  }

  if (ta !== 'object') {
    if (!Object.is(a, b)) out.push({ at, base: fmt(a), now: fmt(b) });
    return out;
  }

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) {
    out.push({ at, base: aArr ? 'array' : 'object', now: bArr ? 'array' : 'object' });
    return out;
  }

  if (aArr) {
    if (a.length !== b.length) {
      out.push({ at: at + '.length', base: a.length, now: b.length });
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n && out.length < MAX_REPORT; i++) diff(a[i], b[i], at + '[' + i + ']', out);
    return out;
  }

  const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();
  for (const k of keys) {
    if (out.length >= MAX_REPORT) break;
    diff(a[k], b[k], at ? at + '.' + k : k, out);
  }
  return out;
}

async function main() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error('没有基线快照，先跑：node tests/_baseline/record.mjs');
    process.exit(1);
  }
  const base = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));

  const srv = await startServer(8901);
  let page = null;
  try {
    page = await openPage({ url: srv.origin + '/gold-minute.html', debugPort: 9333 });
    const now = await collectAll(page);

    // meta 只是说明性信息，不参与比对
    const diffs = diff(
      Object.assign({}, base, { meta: undefined }),
      Object.assign({}, now, { meta: undefined }),
      '',
      []
    );

    if (!diffs.length) {
      console.log('与基线完全一致：kline ' + Object.keys(now.kline).length
        + ' / mtf ' + Object.keys(now.mtf).length
        + ' / rsi ' + Object.keys(now.rsi).length
        + ' / fast ' + Object.keys(now.fast).length
        + ' / probes ' + Object.keys(now.probes).length);
      console.log('\nPASS baseline-verify');
      return;
    }

    console.error('检出 ' + diffs.length + (diffs.length >= MAX_REPORT ? '+' : '') + ' 处差异：\n');
    for (const d of diffs) {
      console.error('  ' + d.at);
      console.error('    基线: ' + d.base);
      console.error('    当前: ' + d.now);
    }
    console.error('\nFAIL baseline-verify');
    process.exit(1);
  } finally {
    if (page) page.close();
    srv.proc.kill();
  }
}

main().catch((err) => {
  console.error('FAIL baseline-verify:', err && err.stack ? err.stack : err);
  process.exit(1);
});
