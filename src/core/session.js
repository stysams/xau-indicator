import { n, pad2 } from './format.js';

export const SESS_VENUES = [
  { id: 'eurasia', short: '欧亚', name: '欧亚盘', hint: 'COMEX Globex：周日到周五美东 18:00 开到次日 17:00，每日 17:00–18:00 日切。' },
  { id: 'japan', short: '日本', name: '日本', hint: 'JPX 黄金：日盘 08:45–15:45 东京，夜盘 17:00–次日 06:00 东京。' },
  { id: 'shfe', short: '沪金', name: '沪金', hint: '上期所黄金期货 AU：09:00–10:15、10:30–11:30、13:30–15:00，夜盘 21:00–02:30。' },
  { id: 'sge', short: '上金', name: '上金所', hint: '上海黄金交易所：日盘 09:00–15:30，夜盘 20:00–02:30。' },
  { id: 'london', short: '欧盘', name: '欧盘', hint: '伦敦 08:00–16:30。夏令时北京 15:00–23:30，冬令时 16:00–00:30。' },
  { id: 'comex', short: '美盘', name: '美盘', hint: 'COMEX 场内 08:20–13:30 美东。' },
  { id: 'nyse', short: '美股', name: '美股', hint: '纽交所、纳斯达克常规交易 09:30–16:00 美东。夏令时北京 21:30–04:00，冬令时 22:30–05:00。感恩节次日和圣诞前夕提早 13:00 美东收盘。' },
];

export const CN_HOLIDAYS = [
  [20260101, 20260103],
  [20260215, 20260223],
  [20260404, 20260406],
  [20260501, 20260505],
  [20260619, 20260621],
  [20260925, 20260927],
  [20261001, 20261007],
];

export const CN_NO_NIGHT = [20251231, 20260213, 20260403, 20260430, 20260618, 20260924, 20260930];

export const US_EQUITY_CLOSED = [20260101, 20260119, 20260216, 20260403, 20260525, 20260619, 20260703, 20260907, 20261126, 20261225];

export const US_EQUITY_EARLY = [20261127, 20261224];

export function usEquityOpenDay(y, mo, d, w) {
  if (w === 0 || w === 6) return false;
  return US_EQUITY_CLOSED.indexOf(ymdNum(y, mo, d)) < 0;
}

export function ymdNum(y, mo, d) { return y * 10000 + mo * 100 + d; }

export function ymdAdd(y, mo, d, n) {
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), w: dt.getUTCDay() };
}

export function cnHoliday(y, mo, d) {
  const n = ymdNum(y, mo, d);
  for (let i = 0; i < CN_HOLIDAYS.length; i++) {
    if (n >= CN_HOLIDAYS[i][0] && n <= CN_HOLIDAYS[i][1]) return true;
  }
  return false;
}

export function cnWorkday(y, mo, d, w) {
  if (w === 0 || w === 6) return false;
  return !cnHoliday(y, mo, d);
}

export function cnNightStart(y, mo, d, w) {
  if (!cnWorkday(y, mo, d, w)) return false;
  return CN_NO_NIGHT.indexOf(ymdNum(y, mo, d)) < 0;
}

export function tzParts(timeZone, date) {
  const cache = tzParts._c || (tzParts._c = Object.create(null));
  let dtf = cache[timeZone];
  if (!dtf) {
    dtf = cache[timeZone] = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });
  }
  const map = {};
  dtf.formatToParts(date).forEach((part) => { map[part.type] = part.value; });
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let h = +map.hour;
  if (h === 24) h = 0;
  return {
    y: +map.year,
    mo: +map.month,
    d: +map.day,
    h: h,
    mi: +map.minute,
    s: +map.second,
    w: wd[map.weekday],
  };
}

export function fromZoned(timeZone, y, mo, d, h, mi, sec) {
  const want = Date.UTC(y, mo - 1, d, h, mi, sec || 0);
  let utc = want;
  for (let i = 0; i < 4; i++) {
    const part = tzParts(timeZone, new Date(utc));
    const got = Date.UTC(part.y, part.mo - 1, part.d, part.h, part.mi, part.s);
    const next = utc + (want - got);
    if (next === utc) break;
    utc = next;
  }
  return utc;
}

export function fmtBj(ms) {
  const part = tzParts('Asia/Shanghai', new Date(ms));
  return pad2(part.h) + ':' + pad2(part.mi);
}

export function fmtRange(start, end) {
  if (start == null || end == null) return '--';
  return fmtBj(start) + '–' + fmtBj(end);
}

export function sessRemain(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--';
  if (ms <= 0) return '已结束';
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + '小时' + m + '分';
  if (m > 0) return m + '分' + pad2(sec) + '秒';
  return sec + '秒';
}

export function addWin(list, venueId, phase, start, end) {
  if (!start || !end || end <= start) return;
  list.push({ venueId: venueId, phase: phase, start: start, end: end });
}

export function collectWindows(now) {
  const out = [];
  const sh = tzParts('Asia/Shanghai', new Date(now));
  const tk = tzParts('Asia/Tokyo', new Date(now));
  const ny = tzParts('America/New_York', new Date(now));
  const ld = tzParts('Europe/London', new Date(now));
  for (let i = -1; i <= 10; i++) {
    const cSh = ymdAdd(sh.y, sh.mo, sh.d, i);
    const cTk = ymdAdd(tk.y, tk.mo, tk.d, i);
    const cNy = ymdAdd(ny.y, ny.mo, ny.d, i);
    const cLd = ymdAdd(ld.y, ld.mo, ld.d, i);
    if (cNy.w >= 0 && cNy.w <= 4) {
      const nx = ymdAdd(cNy.y, cNy.mo, cNy.d, 1);
      addWin(out, 'eurasia', '开盘中',
        fromZoned('America/New_York', cNy.y, cNy.mo, cNy.d, 18, 0, 0),
        fromZoned('America/New_York', nx.y, nx.mo, nx.d, 17, 0, 0));
    }
    if (cNy.w >= 1 && cNy.w <= 5) {
      addWin(out, 'comex', '开盘中',
        fromZoned('America/New_York', cNy.y, cNy.mo, cNy.d, 8, 20, 0),
        fromZoned('America/New_York', cNy.y, cNy.mo, cNy.d, 13, 30, 0));
    }
    if (usEquityOpenDay(cNy.y, cNy.mo, cNy.d, cNy.w)) {
      const early = US_EQUITY_EARLY.indexOf(ymdNum(cNy.y, cNy.mo, cNy.d)) >= 0;
      addWin(out, 'nyse', '开盘中',
        fromZoned('America/New_York', cNy.y, cNy.mo, cNy.d, 9, 30, 0),
        fromZoned('America/New_York', cNy.y, cNy.mo, cNy.d, early ? 13 : 16, 0, 0));
    }
    if (cTk.w >= 1 && cTk.w <= 5) {
      addWin(out, 'japan', '开盘中',
        fromZoned('Asia/Tokyo', cTk.y, cTk.mo, cTk.d, 8, 45, 0),
        fromZoned('Asia/Tokyo', cTk.y, cTk.mo, cTk.d, 15, 45, 0));
      const n1 = ymdAdd(cTk.y, cTk.mo, cTk.d, 1);
      addWin(out, 'japan', '夜盘中',
        fromZoned('Asia/Tokyo', cTk.y, cTk.mo, cTk.d, 17, 0, 0),
        fromZoned('Asia/Tokyo', n1.y, n1.mo, n1.d, 6, 0, 0));
    }
    if (cnWorkday(cSh.y, cSh.mo, cSh.d, cSh.w)) {
      addWin(out, 'shfe', '开盘中',
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 9, 0, 0),
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 10, 15, 0));
      addWin(out, 'shfe', '开盘中',
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 10, 30, 0),
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 11, 30, 0));
      addWin(out, 'shfe', '午盘中',
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 13, 30, 0),
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 15, 0, 0));
      addWin(out, 'sge', '开盘中',
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 9, 0, 0),
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 15, 30, 0));
    }
    if (cnNightStart(cSh.y, cSh.mo, cSh.d, cSh.w)) {
      const n1 = ymdAdd(cSh.y, cSh.mo, cSh.d, 1);
      addWin(out, 'shfe', '夜盘中',
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 21, 0, 0),
        fromZoned('Asia/Shanghai', n1.y, n1.mo, n1.d, 2, 30, 0));
      addWin(out, 'sge', '夜盘中',
        fromZoned('Asia/Shanghai', cSh.y, cSh.mo, cSh.d, 20, 0, 0),
        fromZoned('Asia/Shanghai', n1.y, n1.mo, n1.d, 2, 30, 0));
    }
    if (cLd.w >= 1 && cLd.w <= 5) {
      addWin(out, 'london', '开盘中',
        fromZoned('Europe/London', cLd.y, cLd.mo, cLd.d, 8, 0, 0),
        fromZoned('Europe/London', cLd.y, cLd.mo, cLd.d, 16, 30, 0));
    }
  }
  out.sort(function (a, b) { return a.start - b.start; });
  return out;
}

export function matchVenue(id, now, windows) {
  const mine = windows.filter(function (w) { return w.venueId === id; });
  const cur = mine.find(function (w) { return now >= w.start && now < w.end; });
  if (cur) return { open: true, phase: cur.phase, start: cur.start, end: cur.end };
  const next = mine.find(function (w) { return w.start > now; });
  if (next) return { open: false, phase: '未开盘', start: next.start, end: next.end };
  return { open: false, phase: '未开盘', start: null, end: null };
}

export function sessSnapshot(now) {
  now = now || Date.now();
  const windows = collectWindows(now);
  const items = SESS_VENUES.map(function (v) {
    const st = matchVenue(v.id, now, windows);
    return {
      id: v.id,
      short: v.short,
      name: v.name,
      hint: v.hint,
      open: !!st.open,
      phase: st.phase,
      start: st.start,
      end: st.end,
    };
  });
  return { items: items, now: now };
}

export function venueState(id, now) {
  now = now || Date.now();
  return matchVenue(id, now, collectWindows(now));
}
