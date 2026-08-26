#!/usr/bin/env node
'use strict';

/**
 * Gate.io CFD (TradFi) 公共行情 MCP 服务器
 *
 * 封装 Gate.io CFD 接口的公共行情查询（无需认证）：
 *   - 品种类别 /tradfi/symbols/categories
 *   - 品种列表 /tradfi/symbols
 *   - 实时行情 /tradfi/symbols/{symbol}/tickers
 *   - K 线     /tradfi/symbols/{symbol}/klines
 *
 * 传输：MCP stdio（newline-delimited JSON-RPC）
 */

const https = require('https');
const readline = require('readline');

const API_HOST = 'api.gateio.ws';
const API_PATH = '/api/v4/tradfi';

const SERVER_INFO = { name: 'gate-cfd', version: '1.0.0' };

const SUPPORTED_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

const TOOLS = [
  {
    name: 'gate_cfd_list_categories',
    description:
      '列出 Gate.io CFD(TradFi) 的品种类别：Metals(金属,含黄金XAUUSD)、Stocks(股票)、Indices(指数)、Forex(外汇)、Commodities(商品)。返回各类别的 category_id 和名称。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gate_cfd_list_symbols',
    description:
      '列出 Gate.io CFD(TradFi) 的交易品种列表，可按类别过滤。category_id: 1=Metals(金属,含黄金XAUUSD/白银XAGUSD), 2=Stocks(股票), 3=Indices(指数), 4=Forex(外汇), 5=Commodities(商品)。返回品种代码、描述、类别、杠杆、交易时段等。',
    inputSchema: {
      type: 'object',
      properties: {
        category_id: {
          type: 'number',
          description: '类别代码: 1=Metals, 2=Stocks, 3=Indices, 4=Forex, 5=Commodities',
        },
        limit: { type: 'number', description: '返回数量上限，默认 100' },
      },
    },
  },
  {
    name: 'gate_cfd_get_ticker',
    description:
      '获取 Gate.io CFD 单个品种的实时行情：最新价、涨跌、买卖价(bid/ask)、今日开盘/最高/最低、结算货币、交易时段状态。symbol 例如 XAUUSD(黄金)、NAS100(纳斯达克)、US30(道指)、EURUSD 等。',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: '品种代码，如 XAUUSD、NAS100、US30、SPX500、EURUSD、UKOIL 等',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'gate_cfd_get_klines',
    description:
      '获取 Gate.io CFD 品种的 K 线(OHLCV)数据。kline_type: 1m/5m/15m/30m/1h/4h/1d。默认返回最近 limit 根；也可用 begin_time/end_time(Unix 秒)指定时间范围。每根 K 线含 o(开)/c(收)/h(高)/l(低)/t(时间)和成交量。',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '品种代码，如 XAUUSD' },
        kline_type: {
          type: 'string',
          description: 'K线周期: 1m/5m/15m/30m/1h/4h/1d，默认 1m',
        },
        limit: { type: 'number', description: '返回最近 N 根 K 线，默认 100' },
        begin_time: { type: 'number', description: '开始时间(Unix 秒)' },
        end_time: { type: 'number', description: '结束时间(Unix 秒)' },
      },
      required: ['symbol'],
    },
  },
];

function httpGetJson(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host: API_HOST, path, headers: { Accept: 'application/json' }, timeout: 15000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('上游返回非 JSON: ' + data.slice(0, 200)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('上游请求超时(15s)')));
    req.on('error', reject);
  });
}

async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'gate_cfd_list_categories': {
      return await httpGetJson(API_PATH + '/symbols/categories');
    }
    case 'gate_cfd_list_symbols': {
      const qs = [];
      if (args.category_id != null) qs.push('category_id=' + encodeURIComponent(args.category_id));
      qs.push('limit=' + encodeURIComponent(args.limit || 100));
      return await httpGetJson(API_PATH + '/symbols?' + qs.join('&'));
    }
    case 'gate_cfd_get_ticker': {
      const sym = encodeURIComponent(String(args.symbol).toUpperCase());
      return await httpGetJson(API_PATH + '/symbols/' + sym + '/tickers');
    }
    case 'gate_cfd_get_klines': {
      const sym = encodeURIComponent(String(args.symbol).toUpperCase());
      const qs = ['kline_type=' + encodeURIComponent(args.kline_type || '1m')];
      if (args.begin_time != null) qs.push('begin_time=' + encodeURIComponent(args.begin_time));
      if (args.end_time != null) qs.push('end_time=' + encodeURIComponent(args.end_time));
      if (args.begin_time == null && args.end_time == null) {
        qs.push('limit=' + encodeURIComponent(args.limit || 100));
      }
      return await httpGetJson(API_PATH + '/symbols/' + sym + '/klines?' + qs.join('&'));
    }
    default:
      throw new Error('Unknown tool: ' + name);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    return; // 忽略无法解析的行
  }

  const { id, method, params } = msg;

  // 通知（无 id）：不响应
  if (id === undefined) return;

  try {
    switch (method) {
      case 'initialize': {
        const clientV = params && params.protocolVersion;
        const protocolVersion = SUPPORTED_VERSIONS.includes(clientV) ? clientV : '2025-06-18';
        send({
          jsonrpc: '2.0',
          id,
          result: { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO },
        });
        break;
      }
      case 'ping': {
        send({ jsonrpc: '2.0', id, result: {} });
        break;
      }
      case 'tools/list': {
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
        break;
      }
      case 'tools/call': {
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        try {
          const data = await callTool(name, args);
          send({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: JSON.stringify(data) }] },
          });
        } catch (e) {
          send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: 'Error: ' + (e && e.message ? e.message : String(e)) }],
              isError: true,
            },
          });
        }
        break;
      }
      default: {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'Method not found: ' + method },
        });
      }
    }
  } catch (e) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: 'Internal error: ' + (e && e.message ? e.message : String(e)) },
    });
  }
});

process.stderr.write('gate-cfd MCP server ready (stdio)\n');
