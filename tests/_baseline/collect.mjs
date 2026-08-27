/**
 * 基线采集。record.mjs 与 verify.mjs 共用这一份逻辑，保证两次跑的代码路径完全相同。
 *
 * 全部经由 window.__goldTest 调用页面内部函数，不触碰实现细节。
 * 因此本文件在拆分前后无需改动 —— 只要 __goldTest 的契约不变。
 */

import * as S from './scenarios.mjs';

/**
 * 页面侧稳定序列化：
 * - 键按字典序输出，消除对象构造顺序的影响（那不算行为变化）
 * - 祖先链循环记为 [circular]，DOM 节点只记标签名
 * - NaN / Infinity / undefined 转成可见标记，避免 JSON 静默丢失
 */
const SERIALIZER = `
window.__baseSer = function (root) {
  var stack = [];
  function walk(v, depth) {
    if (v === undefined) return '[undefined]';
    if (v === null) return null;
    var t = typeof v;
    if (t === 'number') return Number.isFinite(v) ? v : String(v);
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'function') return '[function]';
    if (t !== 'object') return String(v);
    if (v.nodeType && v.tagName) return '[dom:' + v.tagName + ']';
    if (stack.indexOf(v) >= 0) return '[circular]';
    if (depth > 14) return '[deep]';
    stack.push(v);
    var out;
    if (Array.isArray(v)) {
      out = [];
      for (var i = 0; i < v.length; i++) out.push(walk(v[i], depth + 1));
    } else {
      out = {};
      var keys = Object.keys(v).sort();
      for (var j = 0; j < keys.length; j++) out[keys[j]] = walk(v[keys[j]], depth + 1);
    }
    stack.pop();
    return out;
  }
  return walk(root, 0);
};
true;
`;

/** 把表达式求值包成 { ok } 或 { error }，单点失败不中断整体采集。 */
function guarded(expr) {
  return `(function () {
    try { return { ok: window.__baseSer(${expr}) }; }
    catch (e) { return { error: String((e && e.message) || e) }; }
  })()`;
}

async function setRsiPeriod(page, n) {
  await page.evalExpr(`(function () {
    var b = document.querySelector('button[data-rsi-n="${n}"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
}

export async function collectAll(page) {
  await page.evalExpr(SERIALIZER);

  const snap = {
    meta: {
      note: '基线快照。全部经 window.__goldTest 采集，时间戳固定在过去，覆盖"全部已收盘"路径。',
      scenarioCounts: {
        kline: S.KLINE_SCENARIOS.length,
        mtf: S.MTF_SCENARIOS.length,
        fast: S.FAST_SCENARIOS.length,
        rsiPeriods: S.RSI_PERIODS.length,
      },
    },
    kline: {},
    mtf: {},
    rsi: {},
    fast: {},
    probes: {},
  };

  // 起点统一：不管 localStorage 里存了什么，都从 RSI14 开始
  await setRsiPeriod(page, 14);

  // ---- 单周期场景 ----
  for (const sc of S.KLINE_SCENARIOS) {
    const bars = S.klinesFor(sc);
    snap.kline[sc.id] = await page.evalExpr(
      guarded(`window.__goldTest.applyKlines(${JSON.stringify(bars)}, ${JSON.stringify(sc.tf)})`)
    );
  }

  // ---- 多周期场景 ----
  for (const sc of S.MTF_SCENARIOS) {
    const pack = S.mtfPackFor(sc);
    const fn = sc.kind === 'hkld' ? 'applyHkld' : 'applyStack';
    snap.mtf[sc.id] = await page.evalExpr(
      guarded(`window.__goldTest.${fn}(${JSON.stringify(pack)})`)
    );
  }

  // ---- RSI 周期回归（A7 修过周期分裂，锁住三个周期各自的输出）----
  {
    const bars = S.klinesFor(S.RSI_SCENARIO);
    for (const n of S.RSI_PERIODS) {
      await setRsiPeriod(page, n);
      snap.rsi['n' + n] = await page.evalExpr(
        guarded(`window.__goldTest.applyKlines(${JSON.stringify(bars)}, '1m')`)
      );
    }
    await setRsiPeriod(page, 14);
  }

  // ---- 快单信号 ----
  for (const sc of S.FAST_SCENARIOS) {
    const bars = S.fastBarsFor(sc);
    const ticker = S.fastTickerFor(sc, bars);
    const barsJson = JSON.stringify(bars);
    const tickerJson = JSON.stringify(ticker);
    snap.fast[sc.id] = {
      preview: await page.evalExpr(
        guarded(`window.__goldTest.evalFastSetup(${barsJson}, ${tickerJson}, true)`)
      ),
      commit: await page.evalExpr(
        guarded(`window.__goldTest.evalFastSetup(${barsJson}, ${tickerJson}, false)`)
      ),
    };
  }

  // ---- 纯函数探针 ----
  snap.probes.spreadTooWide = await page.evalExpr(
    guarded(`${JSON.stringify(S.SPREAD_PROBES)}.map(function (p) {
      return { spread: p[0], tpDist: p[1], wide: window.__goldTest.spreadTooWide(p[0], p[1]) };
    })`)
  );

  snap.probes.rsiSeries = await page.evalExpr(
    guarded(`${JSON.stringify(S.RSI_SERIES_PROBE.periods)}.map(function (n) {
      return { period: n, series: window.__goldTest.rsiSeries(${JSON.stringify(S.RSI_SERIES_PROBE.closes)}, n) };
    })`)
  );

  snap.probes.parseTicker = await page.evalExpr(
    guarded(`${JSON.stringify(S.TICKER_PROBES)}.map(function (p) {
      return { label: p.label, out: window.__goldTest.parseTicker(p.raw) };
    })`)
  );

  snap.probes.parseKlines = await page.evalExpr(
    guarded(`${JSON.stringify(S.KLINE_PROBES)}.map(function (p) {
      return { label: p.label, out: window.__goldTest.parseKlines(p.raw) };
    })`)
  );

  snap.probes.parseStreamName = await page.evalExpr(
    guarded(`${JSON.stringify(S.STREAM_NAME_PROBES)}.map(function (s) {
      return { name: s, out: window.__goldTest.parseStreamName(s) };
    })`)
  );

  snap.probes.session = await page.evalExpr(
    guarded(`${JSON.stringify(S.SESSION_PROBES)}.map(function (p) {
      return {
        label: p.label,
        snapshot: window.__goldTest.sessAt(p.ms),
        venues: ${JSON.stringify(S.VENUE_IDS)}.map(function (id) {
          return { id: id, state: window.__goldTest.sessVenue(id, p.ms) };
        }),
        bj: window.__goldTest.fmtBj(p.ms)
      };
    })`)
  );

  snap.probes.fromZoned = await page.evalExpr(
    guarded(`${JSON.stringify(S.FROM_ZONED_PROBES)}.map(function (a) {
      return { args: a, ms: window.__goldTest.fromZoned(a[0], a[1], a[2], a[3], a[4], a[5], a[6]) };
    })`)
  );

  snap.probes.mkt = await page.evalExpr(guarded('window.__goldTest.mkt()'));
  snap.probes.oscLayout = await page.evalExpr(guarded('window.__goldTest.oscLayout()'));

  return snap;
}
