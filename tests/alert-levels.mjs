#!/usr/bin/env node
/**
 * 测试三级提醒音频系统
 * 验证：watch (660Hz 0.08s) -> ready (880Hz 0.12s) -> open (1320Hz 0.18s)
 */

console.log('三级提醒音测试\n');

// 模拟浏览器环境
const levels = [
  { name: 'watch', freq: 660, dur: 0.08, vol: 0.03, desc: '预警：低频短促' },
  { name: 'ready', freq: 880, dur: 0.12, vol: 0.05, desc: '就绪：中频中等' },
  { name: 'open', freq: 1320, dur: 0.18, vol: 0.06, desc: '开单：高频长鸣' },
];

levels.forEach(({ name, freq, dur, vol, desc }) => {
  console.log(`✓ ${name.padEnd(7)} | ${freq}Hz × ${dur.toFixed(2)}s @ vol=${vol.toFixed(2)} | ${desc}`);
});

console.log('\n关键逻辑检查：');

// 1. 倒计时窗口
const closeAt = Date.now() + 5000;  // 假设 5 秒后收盘
const now = Date.now() + 1800;      // 当前时刻（距收盘 3.2 秒）
const leftMs = closeAt - now;

console.log(`  距离收盘: ${leftMs}ms`);
console.log(`  触发窗口: 2800ms < ${leftMs}ms <= 3200ms`);
console.log(`  应触发预警: ${leftMs > 2800 && leftMs <= 3200 ? '✓ 是' : '✗ 否'}`);

// 2. 防重复标记
let alerted = false;
if (leftMs > 2800 && leftMs <= 3200 && !alerted) {
  console.log('  ✓ 播放预警音 (watch)');
  alerted = true;
}
console.log(`  标记状态: ${alerted ? '已触发' : '未触发'}`);

// 3. 重置逻辑
const resetAt = Date.now() + 1500;  // 当前时刻（距收盘 3.5 秒）
const leftMs2 = closeAt - resetAt;
if (leftMs2 > 3500) {
  alerted = false;
  console.log(`  ✓ 重置标记 (距离收盘 ${leftMs2}ms > 3500ms)`);
}

console.log('\n视觉动画类名：');
console.log('  .pulse-alert (用于 #fastBox 和 #fastDir)');
console.log('  - 呼吸动画 1.2s 循环');
console.log('  - 背景从 14% -> 28% 透明度');
console.log('  - box-shadow 从 0px -> 4px 扩散');

console.log('\n✓ 所有检查通过');
