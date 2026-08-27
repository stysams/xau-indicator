/**
 * 录制基线快照。在拆分 gold-minute.html 之前跑一次。
 *
 *   node tests/_baseline/record.mjs
 *
 * 产出 tests/_baseline/snapshot.json，随后由 verify.mjs 比对。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage } from '../_lib/cdp.mjs';
import { collectAll } from './collect.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = path.join(dir, 'snapshot.json');

function countErrors(node, into) {
  if (node === null || typeof node !== 'object') return into;
  if (Object.prototype.hasOwnProperty.call(node, 'error') && typeof node.error === 'string') {
    into.push(node.error);
    return into;
  }
  if (Array.isArray(node)) {
    for (const x of node) countErrors(x, into);
    return into;
  }
  for (const k of Object.keys(node)) countErrors(node[k], into);
  return into;
}

async function main() {
  const srv = await startServer(8899);
  let page = null;
  try {
    page = await openPage({ url: srv.origin + '/gold-minute.html', debugPort: 9331 });
    const snap = await collectAll(page);
    const json = JSON.stringify(snap, null, 1);
    fs.writeFileSync(SNAPSHOT_PATH, json, 'utf8');

    const errs = countErrors(snap, []);
    const kb = Math.round(json.length / 1024);
    console.log('场景：kline ' + Object.keys(snap.kline).length
      + ' / mtf ' + Object.keys(snap.mtf).length
      + ' / rsi ' + Object.keys(snap.rsi).length
      + ' / fast ' + Object.keys(snap.fast).length
      + ' / probes ' + Object.keys(snap.probes).length);
    console.log('快照：' + SNAPSHOT_PATH + '（' + kb + ' KB）');
    if (errs.length) {
      console.log('\n采集期间捕获到 ' + errs.length + ' 处异常（已计入快照，属于被锁定的行为）：');
      const seen = new Set();
      for (const e of errs) {
        if (seen.has(e)) continue;
        seen.add(e);
        console.log('  - ' + e);
      }
    }
    console.log('\nPASS record');
  } finally {
    if (page) page.close();
    srv.proc.kill();
  }
}

main().catch((err) => {
  console.error('FAIL record:', err && err.stack ? err.stack : err);
  process.exit(1);
});
