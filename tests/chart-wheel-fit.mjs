import { assert, approx } from './_lib/assert.mjs';
import { openPage, startServer } from './_lib/cdp.mjs';

const server = await startServer(8942);
let page;
try {
  page = await openPage({ url: server.origin + '/gold-minute.html', debugPort: 9342 });
  const initial = await page.evalExpr(`(async () => {
    const { state } = await import('/src/state.js');
    const { chartSlice } = await import('/src/view/viewport.js');
    const chart = document.getElementById('chart');
    const bars = Array.from({ length: 180 }, (_, index) => {
      // 保留最近的窄幅行情，之前的大幅波动仍会影响可见区域开头的布林带。
      const close = index < 140 ? 3588 + 38 * (index % 2 ? 1 : -1) : 3588 + index % 6;
      return { t: Date.UTC(2026, 0, 5) + index * 60000, o: close - 0.3, h: close + 0.6, l: close - 0.7, c: close };
    });
    window.__goldTest.applyKlines(bars, '1m');
    window.__goldTest.setInd('*', false);
    window.__goldTest.setInd('boll', true);
    window.__goldTest.setInd('boll3', true);
    window.__goldTest.setInd('rsi', true);
    window.__goldTest.setManualSr('3500-3589-3700');

    window.wheelFitSnapshot = () => {
      const { lo, hi, plotTop, plotBottom, y } = state.chartScale;
      const view = chartSlice(bars);
      const candleLow = Math.min(...view.bars.map(bar => bar.l));
      const candleHigh = Math.max(...view.bars.map(bar => bar.h));
      const band = document.getElementById('ck-boll3-up');
      const bandClip = band?.closest('[clip-path]')?.getAttribute('clip-path');
      const clipRect = bandClip && document.getElementById(bandClip.slice(5, -1))?.querySelector('rect');
      return {
        lo, hi, plotTop, plotBottom,
        priceOffset: state.priceOffset,
        count: view.bars.length,
        coverage: (y(candleLow) - y(candleHigh)) / (plotBottom - plotTop),
        bandExtendsAbovePlot: band ? band.getBBox().y < plotTop : false,
        clipTop: clipRect?.y.baseVal.value,
        clipBottom: clipRect ? clipRect.y.baseVal.value + clipRect.height.baseVal.value : null,
        rsiClipped: Boolean(document.getElementById('ck-rsi')?.closest('[clip-path]')),
        manualLevels: [...chart.querySelectorAll('.manual-sr-level')].map(el => el.dataset.manualSrPrice),
      };
    };

    chart.scrollIntoView({ block: 'start' });
    const rect = chart.getBoundingClientRect();
    return {
      ...window.wheelFitSnapshot(),
      x: Math.round(rect.left + rect.width * 0.35),
      y: Math.round((Math.max(0, rect.top) + Math.min(window.innerHeight - 1, rect.bottom)) / 2),
    };
  })()`);
  assert(initial.manualLevels.includes('3500') && initial.manualLevels.includes('3700'), '默认视图包含手动支撑和压力位');

  const { x, y } = initial;
  const dragY = y + 35;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: dragY, button: 'left', buttons: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: dragY, button: 'left', clickCount: 1 });
  const panned = await page.evalExpr('window.wheelFitSnapshot()');
  assert(panned.priceOffset > 0 && panned.count === initial.count, '纵向拖动应移动价格视窗');

  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y: dragY, deltaX: 0, deltaY: -300 });
  const zoomed = await page.evalExpr('new Promise(resolve => requestAnimationFrame(() => resolve(window.wheelFitSnapshot())))');
  assert(zoomed.count < initial.count, '滚轮应减少可见 K 线根数');
  approx(zoomed.coverage, 1 / 1.16, { atol: 0.01, label: 'K 线在缩放后应占主图的大部分高度' });
  assert(zoomed.priceOffset === 0, '滚轮缩放应重新居中价格视窗');
  assert(zoomed.bandExtendsAbovePlot, '测试行情应使布林上轨延伸出价格视窗');
  assert(zoomed.clipTop === zoomed.plotTop && zoomed.clipBottom === zoomed.plotBottom, '布林带裁剪范围应与主图一致');
  assert(!zoomed.rsiClipped, '相对强弱指标副图不应被主图裁剪');
  assert(zoomed.manualLevels.length === 1 && zoomed.manualLevels[0] === '3589', '缩放后只绘制价格视窗内的手动支压位');

  const reset = await page.evalExpr(`(() => {
    document.getElementById('btnZoomReset').click();
    return window.wheelFitSnapshot();
  })()`);
  assert(reset.count === initial.count && reset.lo === initial.lo && reset.hi === initial.hi, '复位应还原默认价格轴和可见根数');
  console.log(`PASS chart-wheel-fit (${initial.count} → ${zoomed.count} 根，主图高度 ${(zoomed.coverage * 100).toFixed(1)}%)`);
} finally {
  page?.close();
  server.proc.kill();
}
