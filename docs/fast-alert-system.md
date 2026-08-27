# 10秒级开单提醒系统

## 概述

基于现有 10 秒 K 线流的三级声音提醒 + 视觉闪烁系统，在浏览器内实时提醒交易信号。

---

## 三级提醒

| 级别 | 触发时机 | 音频参数 | 视觉效果 | 用途 |
|------|---------|---------|---------|------|
| **watch** | 距离收盘 3 秒 | 660Hz × 0.08s @ vol=0.03 | 无 | 预警：提前注意 |
| **ready** | （保留，暂未使用） | 880Hz × 0.12s @ vol=0.05 | 无 | 就绪：可扩展 |
| **open** | 实际开单 | 1320Hz × 0.18s @ vol=0.06 | 无 | 开单：高频长鸣 |

### 音频特征

- **watch**：低频短促，像"嘀"一声，不打扰但能注意到
- **ready**：中频中等（原 `beepFast()` 音色），可用于未来扩展
- **open**：高频长鸣，明确的开单确认

---

## 视觉闪烁

### 触发条件

当 `state.fastWatch` 存在（即"预备开多/空"状态）时：

- `#fastBox` 面板整体呼吸动画
- `#fastDir` 标题文字呼吸动画
- `.open-badge` 徽章呼吸动画

### CSS 动画

```css
@keyframes pulse-alert {
  0%, 100% {
    background: rgba(183, 122, 22, .14);
    box-shadow: 0 0 0 0 rgba(183, 122, 22, .4);
  }
  50% {
    background: rgba(183, 122, 22, .28);
    box-shadow: 0 0 0 4px rgba(183, 122, 22, 0);
  }
}
```

- 周期：1.2 秒
- 效果：背景透明度 14% → 28%，阴影从 0px 扩散到 4px
- 颜色：警告色（`--warn` 琥珀色）

---

## 倒计时预警逻辑

### 触发窗口

在 `tickFastOpen()` 中每次 tick 检查：

```javascript
const forming = formingFastBars(now);
if (forming && forming.length && state.fastWatch) {
  const lastBar = forming[forming.length - 1];
  const closeAt = (lastBar.t + 10) * 1000;  // 10 秒收盘时刻
  const leftMs = closeAt - now;

  // 倒计时 3 秒时播放预警音（允许 2.8~3.2 秒误差窗口）
  if (leftMs > 2800 && leftMs <= 3200 && !state._fastWatchAlerted) {
    beepAlert('watch');
    state._fastWatchAlerted = true;  // 避免重复播放
  }

  // 重置标记（距离收盘还有 >3.5 秒时重置）
  if (leftMs > 3500) state._fastWatchAlerted = false;
}
```

### 防重复机制

- `state._fastWatchAlerted`：布尔标记，记录本根 10 秒 K 是否已触发预警
- 窗口内只触发一次，避免每次 tick 都播放
- 当距离收盘 >3.5 秒时重置，为下一根 K 线准备

---

## 代码变更

### 1. `src/trade/fast.js`

#### 新增 `beepAlert(level)` 函数

```javascript
export function beepAlert(level) {
  // level: 'watch' (预警) | 'ready' (就绪) | 'open' (开单)
  if (!state.fastBeep) return;
  const tones = {
    watch: { freq: 660, dur: 0.08, vol: 0.03 },
    ready: { freq: 880, dur: 0.12, vol: 0.05 },
    open: { freq: 1320, dur: 0.18, vol: 0.06 },
  };
  const cfg = tones[level] || tones.ready;
  // ... Web Audio API 实现
}
```

#### 修改 `tickFastOpen()`

增加倒计时预警逻辑（见上文"触发窗口"代码块）。

#### 修改 `tryOpenFast()`

将 `beepFast()` 改为 `beepAlert('open')`：

```javascript
state.fastTrade = setup;
recordFastSimOpen(setup);
beepAlert('open');  // 开单：高频长鸣
```

### 2. `src/view/trade-overlay.js`

#### 修改 `renderFastPanel()`

给 `#fastDir` 和 `#fastBox` 添加 `.pulse-alert` 类：

```javascript
dirEl.classList.toggle('is-armed', sig.mode === 'armed');
dirEl.classList.toggle('pulse-alert', sig.mode === 'armed');  // 新增
if (box) {
  box.classList.remove('bull', 'bear', 'chop', 'armed');
  box.classList.add(sig.cls || 'chop');
  box.classList.toggle('pulse-alert', sig.mode === 'armed');  // 新增
}
```

### 3. `src/style.css`

新增动画定义和应用类：

```css
@keyframes pulse-alert { /* 见上文 */ }
.open-badge.armed.pulse-alert { animation: pulse-alert 1.2s ease-in-out infinite; }
#fastBox.pulse-alert { animation: pulse-alert 1.2s ease-in-out infinite; border-left: 3px solid var(--warn); }
#fastDir.pulse-alert { animation: pulse-alert 1.2s ease-in-out infinite; }
```

---

## 测试

运行测试脚本验证参数：

```bash
node tests/alert-levels.mjs
```

输出：

```
三级提醒音测试

✓ watch   | 660Hz × 0.08s @ vol=0.03 | 预警：低频短促
✓ ready   | 880Hz × 0.12s @ vol=0.05 | 就绪：中频中等
✓ open    | 1320Hz × 0.18s @ vol=0.06 | 开单：高频长鸣

✓ 所有检查通过
```

---

## 用户体验

### 典型流程

1. **等待信号**：界面显示"等待开单"，无提示
2. **形成预告**（T-10秒）：出现"预备开多/空"，面板开始呼吸动画
3. **倒计时预警**（T-3秒）：播放低频"嘀"一声，提醒即将收盘
4. **开单确认**（T=0秒）：播放高频长鸣，面板变为"开多/空"，动画停止

### 降噪设计

- 预警音音量仅 3%，持续 80ms，不刺耳
- 开单音音量 6%，持续 180ms，有存在感但不吵
- 视觉动画仅在"预备"状态，开单后立即停止
- 窗口误差 ±0.2 秒，避免边界抖动

---

## 扩展建议

### 方案B：浏览器通知

如需离开标签页也能收到，可添加：

```javascript
export async function requestNotifyPerm() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

export function notifyFast(title, body) {
  if (!state.fastBeep || Notification.permission !== 'granted') return;
  new Notification(title, {
    body: body,
    icon: '/favicon.ico',
    tag: 'fast-trade',
    requireInteraction: true,
  });
}
```

在 `tryOpenFast()` 中调用 `notifyFast('🔔 开单提醒', setup.reason)`。

### 方案C：Webhook 推送

需后端支持，可推送到手机（微信/钉钉/Telegram）：

```javascript
async function pushWebhook(trade) {
  const url = 'https://your-webhook-endpoint.com/notify';
  const payload = {
    time: new Date(trade.entryAt).toLocaleString('zh-CN'),
    direction: trade.dir > 0 ? '做多' : '做空',
    entry: trade.entry,
    reason: trade.reason,
  };
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
```

---

## 配置

### 禁用提醒

用户可通过界面关闭 `state.fastBeep = false`，此时：

- 所有 `beepAlert()` 调用自动跳过
- 视觉闪烁仍保留

### 调整参数

修改 `src/trade/fast.js` 的 `tones` 对象：

```javascript
const tones = {
  watch: { freq: 660, dur: 0.08, vol: 0.03 },  // 调整频率、时长、音量
  // ...
};
```

### 调整触发窗口

修改 `tickFastOpen()` 中的条件：

```javascript
if (leftMs > 2800 && leftMs <= 3200 && !state._fastWatchAlerted) {
  // 窗口：2.8~3.2 秒，可改为 1.5~2.5 秒等
}
```

---

## 注意事项

1. **浏览器需保持打开**：WebSocket 断开后无法接收行情
2. **音频上下文限制**：首次播放可能需用户手势激活（点击按钮等）
3. **时区同步**：依赖客户端 `Date.now()`，确保系统时间准确
4. **性能开销**：每次 tick 检查倒计时，约 1ms 级别，可忽略

---

## 架构依赖

- **数据源**：`src/net/ws.js` 的 10 秒 WebSocket 流
- **信号引擎**：`src/trade/fast.js` 的 `evalFastSetup()`
- **渲染层**：`src/view/trade-overlay.js` 的 `renderFastPanel()`
- **状态管理**：`src/state.js` 的 `state.fast`、`state.fastWatch`

变更完全兼容现有架构，无破坏性修改。
