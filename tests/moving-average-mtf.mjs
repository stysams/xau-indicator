import { buildAverageSeries, normalizeAverageLines } from '../src/indicators/moving-average.js';
import { assert, approx } from './_lib/assert.mjs';

function bars(count, start, span, closeAt) {
  return Array.from({ length: count }, (_, i) => {
    const c = closeAt(i);
    return { t: start + i * span, o: c, h: c, l: c, c: c };
  });
}

{
  const lines = normalizeAverageLines([
    { kind: 'MA', period: 100, tf: '1d' },
    { kind: 'ma', period: 100, tf: '1d' },
    { kind: 'ema', period: 21, tf: '15m' },
    { kind: 'ema', period: 7, tf: '1m' },
  ]);
  assert(lines.length === 2, 'normalize should dedupe and reject unsupported periods');
  assert(lines[0].kind === 'ema' && lines[0].tf === '15m', 'normalize should use stable timeframe ordering');
  assert(lines[1].kind === 'ma' && lines[1].period === 100, 'normalize should preserve daily MA100');
}

// 日线 MA 映射到分钟图时只使用已经收盘的日线，不能提前使用当天最终收盘价。
{
  const day = 86400;
  const daily = bars(105, day, day, (i) => i + 1);
  const currentDayOpen = daily[104].t;
  const chart = bars(2, currentDayOpen, 60, () => 500);
  const line = buildAverageSeries(chart, '1m', { '1d': daily }, [
    { kind: 'ma', period: 100, tf: '1d' },
  ])[0];
  approx(line.values[0], 54.5, { label: 'daily MA100 on first minute' });
  approx(line.values[1], 54.5, { label: 'daily MA100 excludes forming daily candle' });
  assert(line.label === '1日 MA100', 'daily line label');
}

// 当前图周期也会合并多周期缓存的较早历史，180 根主图仍可画 MA200。
{
  const minute = 60;
  const history = bars(205, minute, minute, (i) => i + 1);
  const chart = history.slice(-6);
  const line = buildAverageSeries(chart, '1m', { '1m': history }, [
    { kind: 'ma', period: 200, tf: '1m' },
  ])[0];
  approx(line.values[0], 100.5, { label: 'same timeframe MA200 uses cached history' });
  approx(line.values[5], 105.5, { label: 'same timeframe MA200 latest' });
}

console.log('PASS moving-average-mtf');
