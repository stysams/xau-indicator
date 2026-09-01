import { assert, approx } from './_lib/assert.mjs';
import { chartXScale, priceLevelsInRange } from '../src/view/viewport.js';

function verify(view, barIndex, localIndex, expectedX, label) {
  const scale = chartXScale(view, 10, 110);
  approx(scale.index(barIndex), expectedX, { label: label + ' global index' });
  approx(scale.local(localIndex), expectedX, { label: label + ' local index' });
}

// 历史区：全局索引与切片内索引必须落在同一根 K 线上。
verify({ start: 40, count: 10 }, 43, 3, 45, 'history viewport');

// 左侧留白：数据从第 0 根开始，前三个视窗槽位为空。
verify({ start: -3, count: 10 }, 2, 2, 65, 'left padding');

// 右侧留白：拖到实时端后，已有 K 线仍按全局视窗槽位定位。
verify({ start: 95, count: 10 }, 99, 4, 55, 'right padding');

{
  const scale = chartXScale({ start: 40, count: 10 }, 10, 110);
  assert(scale.clampedIndex(39) === 10, 'overlay before viewport clamps left');
  assert(scale.clampedIndex(50) === 110, 'overlay after viewport clamps right');
  approx(scale.clampedIndex(43), 45, { label: 'overlay in viewport' });
}

{
  const levels = [
    { price: 98, id: 'below' },
    { price: 101, id: 'visible' },
    { price: 104, id: 'above' },
  ];
  const visible = priceLevelsInRange(levels, 100, 102);
  assert(visible.length === 1 && visible[0].id === 'visible', 'fixed price levels do not expand viewport range');
  assert(priceLevelsInRange(levels, 102, 100).length === 1, 'price range accepts reversed bounds');
}

console.log('PASS viewport-coordinates');
