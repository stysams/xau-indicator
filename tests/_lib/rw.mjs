/** mulberry32：种子化 [0,1) 伪随机。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 种子化随机漫步 OHLC。
 * mode:
 *   - cont：下一根 open = 上一根 close（连续行情）
 *   - gap ：在开盘注入约 ±gapNoise 的跳空
 * drift：每根的期望收益，默认 0（无趋势）。写进 return 而不是事后叠加，
 *        这样 open = 上一根 close 的连续性仍然成立。
 */
export function randomWalkOHLC(opts) {
  const n = (opts && opts.n) || 180;
  const seed = (opts && opts.seed != null) ? opts.seed : 1;
  const start = (opts && opts.start != null) ? opts.start : 2650;
  const vol = (opts && opts.vol != null) ? opts.vol : 0.35;
  const drift = (opts && opts.drift != null) ? opts.drift : 0;
  const mode = (opts && opts.mode) || 'cont';
  const gapNoise = (opts && opts.gapNoise != null) ? opts.gapNoise : 0.02;
  const t0 = (opts && opts.t0 != null) ? opts.t0 : 1_700_000_000;
  const step = (opts && opts.step != null) ? opts.step : 60;

  const rnd = mulberry32(seed);
  const bars = [];
  let prevC = start;
  for (let i = 0; i < n; i++) {
    let o;
    if (i === 0) o = start;
    else if (mode === 'gap') o = prevC + (rnd() * 2 - 1) * gapNoise;
    else o = prevC;

    const ret = (rnd() * 2 - 1) * vol + drift;
    const c = o + ret;
    const wick = vol * (0.15 + rnd() * 0.55);
    const h = Math.max(o, c) + rnd() * wick;
    const l = Math.min(o, c) - rnd() * wick;
    bars.push({ t: t0 + i * step, o: o, h: h, l: l, c: c });
    prevC = c;
  }
  return bars;
}
