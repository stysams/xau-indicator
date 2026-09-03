import { n } from '../core/format.js';
import { state } from '../state.js';

export const FAC_ITEMS = [
  { k: 'ema', lab: '均线结构' },
  { k: 'vwap', lab: '日内均价' },
  { k: 'dxy', lab: 'DXY对照' },
  { k: 'xauUsidx', lab: 'XAU-USIDX相关' },
  { k: 'rsi', lab: 'RSI' },
  { k: 'swing', lab: '高低点' },
  { k: 'tape', lab: '近端 K 线' },
  { k: 'boll', lab: '布林' },
  { k: 'macd', lab: 'MACD' },
  { k: 'sig', lab: '布林配 MACD' },
  { k: 'stack', lab: '套轨' },
  { k: 'hkld', lab: '高空低多' },
  { k: 'range', lab: '震荡位置' },
  { k: 'fib', lab: '斐波那契' },
  { k: 'smc', lab: 'SMC' },
  { k: 'hs', lab: '头肩形态' },
  { k: 'sr', lab: '支撑压力' },
  { k: 'trap', lab: '诱空诱多' },
  { k: 'hold', lab: '企稳' },
  { k: 'bounce', lab: '反弹' },
  { k: 'pull', lab: '回踩' },
  { k: 'day', lab: '日内位置' },
  { k: 'mtf', lab: '多周期' },
];

export const FAC_FAMILY = {
  ema: 'mom', vwap: 'mom', rsi: 'mom', macd: 'mom', sig: 'mom', boll: 'mom', tape: 'mom',
  dxy: 'macro',
  xauUsidx: 'macro',
  mtf: 'mom', stack: 'mom', hkld: 'mom',
  swing: 'struct', smc: 'struct', hs: 'struct',
  sr: 'touch', trap: 'touch', bounce: 'touch', pull: 'touch', fib: 'touch', hold: 'touch',
  day: 'pos', range: 'pos',
};

export const FAC_FAMILY_W = { mom: 1.0, struct: 1.2, touch: 1.0, pos: 0.6, macro: 0.8 };

export const FAC_FAMILY_LAB = { mom: '动量', struct: '结构', touch: '触位收回', pos: '位置', macro: '宏观对照' };

export const JUDGE_NET_RATIO = 0.35;

export const CORE_FAMILIES = { mom: true, struct: true };

// XAU-USIDX 是 DXY 的关系确认版；同属宏观族时优先使用已确认的关系票，
// 避免同一段美元驱动被两次计票。
export const FAC_PICK_PRI = { stack: 5, smc: 4, xauUsidx: 4, mtf: 3, ema: 2, sig: 1, dxy: 0 };

export const FAC_KEY = 'gold-minute-fac';

export function factorOn(k) {
  return state.fac[k] !== false;
}

export function factorFamilyId(f) {
  if (f && f.id && FAC_FAMILY[f.id]) return FAC_FAMILY[f.id];
  const n = (f && f.name) || '';
  if (/均线|RSI|MACD|布林|近端|套轨|高空|低多|多周期|上破|下破/.test(n)) return 'mom';
  if (/高低|SMC|头肩/.test(n)) return 'struct';
  if (/支撑|压力|诱|企稳|受阻|反弹|回踩|斐波那契|超涨|超跌|杀跌|拉升/.test(n)) return 'touch';
  if (/日内|24小时/.test(n)) return 'pos';
  return 'mom';
}

export function sortFactorsByOrder(factors, order) {
  const list = factors.slice();
  if (order && order.length) {
    const ord = new Map(order.map((id, i) => [id, i]));
    list.sort((a, b) => (ord.has(a.id) ? ord.get(a.id) : 1e9) - (ord.has(b.id) ? ord.get(b.id) : 1e9));
  }
  return list;
}

export function pickFamilyVote(members) {
  let best = null;
  let bestAbs = 0;
  let bestPri = -1;
  members.forEach((f) => {
    const v = f.vote || 0;
    if (!v) return;
    const abs = Math.abs(v);
    const pri = FAC_PICK_PRI[f.id] || 0;
    if (abs > bestAbs || (abs === bestAbs && pri > bestPri)) {
      best = f;
      bestAbs = abs;
      bestPri = pri;
    }
  });
  if (!best) return { vote: 0, pick: null };
  return { vote: best.vote > 0 ? 1 : -1, pick: best };
}
