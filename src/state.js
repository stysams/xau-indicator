export const W = 960, H = 400;

export const PAD = { l: 10, r: 68, t: 14, b: 26 };

export const FAST_LIMIT = 180;

export const SIM_AUTO_DEFAULTS = { tpAtr: 1.2, slAtr: 0.95, holdSec: 180, coolSec: 20 };

export const LIVE_ANCHOR = 0.38;

export const SIM_HIST_MAX = 200;

export const MKT_KEY = 'gold-minute-mkt';

export const MARKETS = {
  xau: {
    id: 'xau', kind: 'cfd', symbol: 'XAUUSD', settle: '',
    name: '黄金', title: '黄金分钟台', sub: 'Gate.io CFD 公共行情 · 现货黄金 XAUUSD',
    digits: 2, tick: 0.01, atrFloor: 0.4, hasSession: true, ws10s: false,
    roundMerge: 1, roundStand: { '1h': 10, '4h': 10, '1d': 10, default: 5 },
    // 地板按安静市 ATR 量级设定，避免常态下 tpAtr/slAtr 滑杆被恒定钳死
    fast: { tpAtr: 1.2, slAtr: 0.95, tpMin: 0.55, slMin: 0.4, tpMax: 3.2, slMax: 2.6 },
    stream: ['1m', '5m', '15m', '1h', '4h', '1d'],
  },
  eth: {
    id: 'eth', kind: 'perp', symbol: 'ETH_USDT', settle: 'usdt',
    name: 'ETH', title: 'ETH 永续台', sub: 'Gate.io USDT 永续 · ETH_USDT',
    digits: 2, tick: 0.01, atrFloor: 0.4, hasSession: false, ws10s: true,
    roundMerge: 1, roundStand: { '1h': 50, '4h': 50, '1d': 50, default: 10 },
    fast: { tpAtr: 1.2, slAtr: 0.95, pctMin: 0.00045, pctMax: 0.0016 },
    stream: ['10s', '1m', '5m', '15m', '1h', '4h', '1d'],
  },
  btc: {
    id: 'btc', kind: 'perp', symbol: 'BTC_USDT', settle: 'usdt',
    name: 'BTC', title: 'BTC 永续台', sub: 'Gate.io USDT 永续 · BTC_USDT',
    digits: 1, tick: 0.1, atrFloor: 4, hasSession: false, ws10s: true,
    roundMerge: 10, roundStand: { '1h': 100, '4h': 100, '1d': 100, default: 50 },
    fast: { tpAtr: 1.2, slAtr: 0.95, pctMin: 0.0004, pctMax: 0.0015 },
    stream: ['10s', '1m', '5m', '15m', '1h', '4h', '1d'],
  },
};

export function readSavedMkt() {
  try {
    const id = localStorage.getItem(MKT_KEY);
    if (id && MARKETS[id]) return id;
  } catch (e) {}
  return 'xau';
}

export const $ = (id) => document.getElementById(id);

export function mkt() { return MARKETS[state.mkt] || MARKETS.xau; }

export function streamTfs() { return mkt().stream; }

export function simKey() { return 'gold-minute-sim-' + mkt().id; }

export function isMarketOpen(ticker) {
  if (!mkt().hasSession) return true;
  return !ticker || !ticker.status || ticker.status === 'open';
}

export const state = {
  mkt: readSavedMkt(),
  reqId: 1,
  wsWanted: false,
  tf: '1m',
  limit: 180,
  paused: false,
  ticker: null,
  klines: [],
  mtf: {},
  hover: -1,
  inflight: false,
  ws: null,
  wsOk: false,
  wsDirectFailed: false,
  backoff: 1000,
  reconn: 0,
  pingTimer: 0,
  barClosed: false,
  chartScale: null,
  quoteRaf: 0,
  chartRaf: 0,
  heavyAt: 0,
  viewCount: null,
  viewEnd: null,
  followLive: true,
  drag: null,
  pointer: null,
  ind: {
    ema9: false, ema21: false, boll: false, smc: false, smcSig: false, stack: false, hkld: false, fib: false, hs: false, sr: false, bounce: false, pull: false, trap: false, hold: false, last: false, hl: false,
    boll1: false, boll2: false, boll3: false, macd: false, rsi: false, fast: false, st: false, box: false,
  },
  stN: 10,
  stK: 3,
  boxLen: 120,
  bollN: 20,
  bollK: 2,
  bollStyle: {
    1: { dash: true, line: '#4a8f8d', fill: '#4a8f8d', fillOn: false },
    2: { dash: true, line: '#176c6b', fill: '#176c6b', fillOn: true },
    3: { dash: true, line: '#6b7d7c', fill: '#6b7d7c', fillOn: false },
  },
  rsiN: 14,
  _bmKey: '',
  _bm: null,
  _stackKey: '',
  _stack: null,
  _hkldKey: '',
  _hkld: null,
  _fibKey: '',
  _fib: null,
  _hsKey: '',
  _hs: null,
  _srKey: '',
  _sr: null,
  _smcKey: '',
  _smc: null,
  _stKey: '',
  _st: null,
  _boxKey: '',
  _box: null,
  _pbKey: '',
  _pb: null,
  _trapKey: '',
  _trap: null,
  _holdKey: '',
  _hold: null,
  fast: [],
  fastTrade: null,
  fastLast: null,
  fastHist: [],
  fastMarks: [],
  fastCoolUntil: 0,
  fastLastEvalT: 0,
  fastReplay: false,
  fastWatch: null,
  fastBeep: true,
  fastPos: null,
  fastDrag: null,
  simDir: 1,
  simOrders: [],
  simLastClose: null,
  simAuto: false,
  simAutoParams: Object.assign({}, SIM_AUTO_DEFAULTS),
  simJudge: null,
  biasW: null,
  biasCollapsed: false,
  biasDrag: null,
  fac: {},
  facOrder: null,
  _facDrag: false,
  sigRail: true,
  showMtf: true,
  layoutId: '',
  layoutCustom: null,
  _sigEvents: null,
  _sigHover: null,
};

export const MIN_BARS = 12;

export const MAX_VIEW_SLOTS = 960;
