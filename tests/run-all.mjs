import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const tests = ['math-indicators.mjs', 'swing-sr.mjs', 'trend-box.mjs', 'hkld-confidence.mjs', 'smc-bias.mjs', 'rw-benchmark.mjs', 'oos-split.mjs'];

// 基线回归要开 headless Chrome，默认不跑。
// 改动 src/ 之后建议跑一次：WITH_BROWSER=1 node tests/run-all.mjs
if (process.env.WITH_BROWSER) tests.push('_baseline/verify.mjs');

let failed = 0;
for (let i = 0; i < tests.length; i++) {
  const file = tests[i];
  console.log('\n=== ' + file + ' ===');
  const r = spawnSync(process.execPath, [path.join(dir, file)], {
    stdio: 'inherit',
    env: process.env,
    cwd: path.resolve(dir, '..'),
  });
  if (r.error) {
    console.error(r.error);
    failed = 1;
    continue;
  }
  if (r.status !== 0) failed = 1;
}

if (failed) {
  console.error('\nFAIL tests/run-all');
  process.exit(1);
}
console.log('\nPASS tests/run-all');
