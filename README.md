# 分钟台 · XAUUSD

本地盯盘页，读取 Gate.io 公共行情，用来对照黄金 CFD、ETH 永续和 BTC 永续的价格结构。

页面会给出均线、布林、多周期和形态对照，也会给出纸面开单信号与模拟成交记录。这些内容只描述结构，不是下单指令，也不构成投资建议。本仓库不会向交易所发单。

仓库地址：<https://github.com/stysams/xau-indicator>

## 最新更新

### 2026-08-27

模拟交易弹窗支持自动开单开关、止盈止损和持仓冷却参数，并可根据当前页面已加载的全部K线判断多空方向。详见[发布说明](docs/releases/release-notes.md)。

![黄金分钟台桌面，1 分钟 180 根](memory/_bars-180.png)

## 快速开始

需要本机已安装 [Node.js](https://nodejs.org/)（建议 18 或更高）。没有额外依赖，不必执行 `npm install`。

在仓库根目录启动本地服务：

```bash
node serve.js
```

浏览器打开 <http://127.0.0.1:8787>。

服务只监听 `127.0.0.1:8787`。默认首页是 `gold-minute.html`。不要用 `file://` 直接打开页面：浏览器没有 CORS，无法直连 Gate.io REST。

可用环境变量改端口：

```bash
set PORT=8787
node serve.js
```

## 仓库里有什么

| 路径 | 作用 |
| --- | --- |
| `gold-minute.html` | 分钟台页面：K 线、指标、左侧判断、纸面模拟 |
| `serve.js` | 本地静态服务，并转发 TradFi / 永续 REST 与 WebSocket |
| `server.js` | Gate.io CFD 公共行情 MCP，走标准输入输出，给其它工具查询用 |
| `memory/*.png` | README 引用的界面截图。日记 Markdown 与校验脚本不入库 |

页面行情不经过 `server.js`。MCP 是另一条查询通道。

## 分钟台能做什么

### 品种

- 黄金：Gate.io CFD / TradFi，代码 `XAUUSD`
- ETH：Gate.io USDT 永续，代码 `ETH_USDT`
- BTC：Gate.io USDT 永续，代码 `BTC_USDT`

### 主图

- 周期：10 秒、1 分、5 分、15 分、1 小时、4 小时、1 日
- 根数：180、360、480，默认 180
- 滚轮对准鼠标位置缩放，拖动平移，双击或「复位」回到盯盘视窗
- 盯盘时最新一根默认放在画面中间偏左，右侧留空，可贴右沿跟随实时最后一根

第一次打开时，主图指标默认全部关闭。本机已经记住过开关的，仍按上次。

### 指标

主条固定 8 项：BOLL、SMC、头肩、支压、现价、RSI、MACD、开单。其余收进右侧下拉。

| 指标 | 做什么 |
| --- | --- |
| BOLL | 默认 20 周期、2 倍标准差。可叠加 1σ / 主轨 / 3σ，可改周期、倍数、实线或虚线、线条颜色和背景 |
| SMC | 近端结构突破、订单区块、未回补缺口。做多做空箭头由「SMC多空」单独开关 |
| 头肩 | 摆动点找左肩、头、右肩和颈线。收盘穿过颈线才算完成 |
| 支压 | 摆动点按约 0.4 倍 ATR 聚成水平位。收盘越过后支撑压力角色互换 |
| RSI | Wilder 平滑，默认 14，可改 6 或 9。70 / 30 是超买超卖带，超买超卖不加方向票 |
| MACD | 12 / 26 / 9。可与布林组成复合信号，只描述近端结构是否对齐 |
| 开单 | 1 分和 5 分定方向，10 秒回踩或触轨收回后给出开多或开空。正在走的那根只预备，收盘才记纸面仓 |
| 高低 / 反弹 / 回踩 / 诱空诱多 / 企稳 / 套轨 / 高空低多 / 斐波那契 / EMA9 / EMA21 | 在指标下拉里单独开关 |

判断栏左侧的因子勾选和主图开关是分开的：可以只画不计入判断，也可以只判断不画。

### 界面截图

截图文件都在仓库的 `memory/` 目录。README 用根目录相对路径引用，GitHub 会直接显示。本机跑起 `serve.js` 后，同一文件对应 `/memory/<文件名>`，例如 <http://127.0.0.1:8787/memory/_bars-180.png>。

| 截图 | 仓库路径 | 本机地址 |
| --- | --- | --- |
| 桌面 180 根 | `memory/_bars-180.png` | `/memory/_bars-180.png` |
| 桌面 360 根 | `memory/_bars-360.png` | `/memory/_bars-360.png` |
| 桌面 480 根 | `memory/_bars-480.png` | `/memory/_bars-480.png` |
| 手机 180 根 | `memory/_bars-mobile.png` | `/memory/_bars-mobile.png` |
| 企稳开关 | `memory/_hold-menu.png` | `/memory/_hold-menu.png` |
| 1 分企稳受阻 | `memory/_hold-live.png` | `/memory/_hold-live.png` |
| 5 分企稳受阻 | `memory/_hold-live-5m.png` | `/memory/_hold-live-5m.png` |
| 合成样本标注 | `memory/_hold-synth.png` | `/memory/_hold-synth.png` |

**根数：180 / 360 / 480**

![360 根](memory/_bars-360.png)

![480 根](memory/_bars-480.png)

**手机**

![手机宽度 180 根](memory/_bars-mobile.png)

**企稳 / 受阻**

开关在指标下拉。影线探到支撑、均线或前低后收盘守在这一侧标企稳；碰到压力或前高后收盘仍在下方标受阻。正在走的那根只标预备。

![指标下拉中的企稳开关](memory/_hold-menu.png)

![1 分钟真实行情上的企稳与受阻](memory/_hold-live.png)

![5 分钟真实行情上的企稳与受阻](memory/_hold-live-5m.png)

![合成样本上的企稳与受阻标注](memory/_hold-synth.png)

### 其它界面

- 红涨绿跌 / 红跌绿涨，写入本机
- 黄金显示各交易所开盘时段（状态条，不弹提醒）
- 模拟交易：多笔订单，按品种分 key 存在本机，按点击时的最新价开平，不向交易所发单
- 快单窗口可拖动，触发后会把开仓价、平仓价和盈亏价差记入模拟订单

## 数据从哪来

全部是 Gate.io 公共接口。

| 品种 | REST | WebSocket |
| --- | --- | --- |
| 黄金 | `/api/v4/tradfi` | `wss://fx-ws.gateio.ws/v4/ws/tradfi` |
| ETH / BTC | `/api/v4/futures/usdt` | `wss://fx-ws.gateio.ws/v4/ws/usdt` |

`serve.js` 把浏览器请求转到这些地址：

- `/api/v4/tradfi/*`、`/api/v4/futures/*` → `api.gateio.ws`
- `/ws/tradfi` → `fx-ws.gateio.ws/v4/ws/tradfi`
- `/ws/futures` → `fx-ws.gateio.ws/v4/ws/usdt`

1 分、5 分、15 分、1 小时、4 小时、1 日的 K 线和报价走实时推送，大约 250 毫秒更新一次，历史根用 REST 补齐。黄金 10 秒线有 REST 历史，但 TradFi 推送通道不更新 10 秒，正在走的那根用报价按 10 秒归桶。永续 10 秒线推送通道会更新。

黄金 K 线没有成交量。永续 K 线有量，主图仍按价格结构画，没有另开量能副图。

页面优先直连 Gate.io WebSocket；连不上时再走本机 `/ws/tradfi` 或 `/ws/futures` 转发。

## MCP 服务器

`server.js` 用标准输入输出提供 Gate.io CFD 公共查询，无需 API 密钥。工具名：

- `gate_cfd_list_categories`：品种类别
- `gate_cfd_list_symbols`：品种列表，可按类别过滤
- `gate_cfd_get_ticker`：单品种实时行情
- `gate_cfd_get_klines`：K 线，周期 `1m` / `5m` / `15m` / `30m` / `1h` / `4h` / `1d`

示例配置（把路径换成你的本机目录）：

```json
{
  "mcpServers": {
    "gate-cfd": {
      "command": "node",
      "args": ["D:/project/ai/xauusd/server.js"]
    }
  }
}
```

MCP 只覆盖 CFD / TradFi。ETH、BTC 永续请用分钟台或 `serve.js` 的 futures 转发。

## 本机记住什么

开关、配色、模拟订单、左侧栏宽度、快单窗口位置等写在浏览器 `localStorage`，键名以 `gold-minute-` 开头，按品种分开存放。清站点数据就会丢掉这些记录。

## 免责声明

这是结构对照工具，不预测涨跌，不构成投资建议，也不会代你下单。点差过大时纸面开单会暂停。更细的口径、节假日和形态规则写在页面底部「数据说明与免责声明」。
