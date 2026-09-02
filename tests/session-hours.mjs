import { fromZoned, fmtRange, sessSnapshot, venueState } from '../src/core/session.js';
import { assert } from './_lib/assert.mjs';

function bj(y, mo, d, h, mi) {
  return fromZoned('Asia/Shanghai', y, mo, d, h, mi || 0, 0);
}

function item(ms, id) {
  const found = sessSnapshot(ms).items.find((x) => x.id === id);
  assert(found, 'missing venue ' + id);
  return found;
}

function expectOpen(ms, id, phase, range, label) {
  const x = item(ms, id);
  assert(x.open === true, label + ': ' + id + ' should be open, got ' + x.phase + ' ' + fmtRange(x.start, x.end));
  assert(x.phase === phase, label + ': ' + id + ' phase got ' + x.phase + ', want ' + phase);
  const got = fmtRange(x.start, x.end);
  assert(got === range, label + ': ' + id + ' range got ' + got + ', want ' + range);
}

function expectClosed(ms, id, nextRange, label) {
  const x = item(ms, id);
  assert(x.open === false, label + ': ' + id + ' should be closed, got ' + x.phase + ' ' + fmtRange(x.start, x.end));
  if (nextRange) {
    const got = fmtRange(x.start, x.end);
    assert(got === nextRange, label + ': ' + id + ' next range got ' + got + ', want ' + nextRange);
  }
}

// --- 上金所：早市 09:00-11:30、午休、午市 13:30-15:30、夜市 20:00-02:30 ---
{
  const mon = [2026, 3, 16];
  expectOpen(bj(...mon, 10, 0), 'sge', '开盘中', '09:00–11:30', 'sge morning');
  expectClosed(bj(...mon, 12, 0), 'sge', '13:30–15:30', 'sge lunch');
  expectOpen(bj(...mon, 14, 0), 'sge', '午盘中', '13:30–15:30', 'sge afternoon');
  expectClosed(bj(...mon, 16, 0), 'sge', '20:00–次日02:30', 'sge after close');
  expectOpen(bj(...mon, 21, 0), 'sge', '夜盘中', '20:00–次日02:30', 'sge night');
  expectOpen(bj(2026, 3, 17, 1, 0), 'sge', '夜盘中', '20:00–次日02:30', 'sge night after midnight');
}

// --- 沪金：保留 10:15-10:30 休息，午盘 15:00 收，夜盘 21:00 ---
{
  const mon = [2026, 3, 16];
  expectOpen(bj(...mon, 10, 0), 'shfe', '开盘中', '09:00–10:15', 'shfe first');
  expectClosed(bj(...mon, 10, 20), 'shfe', '10:30–11:30', 'shfe tea');
  expectOpen(bj(...mon, 11, 0), 'shfe', '开盘中', '10:30–11:30', 'shfe second');
  expectOpen(bj(...mon, 14, 0), 'shfe', '午盘中', '13:30–15:00', 'shfe afternoon');
  expectClosed(bj(...mon, 15, 10), 'shfe', '21:00–次日02:30', 'shfe after 15:00');
  expectOpen(bj(...mon, 21, 30), 'shfe', '夜盘中', '21:00–次日02:30', 'shfe night');
}

// --- 欧盘：伦敦 08:00-17:00，不再用伦交所 16:30 ---
{
  expectOpen(bj(2026, 7, 15, 15, 30), 'london', '开盘中', '15:00–次日00:00', 'london summer open');
  expectOpen(bj(2026, 7, 15, 23, 45), 'london', '开盘中', '15:00–次日00:00', 'london summer late');
  expectClosed(bj(2026, 7, 16, 0, 5), 'london', '15:00–次日00:00', 'london summer closed');
  expectOpen(bj(2026, 1, 15, 16, 30), 'london', '开盘中', '16:00–次日01:00', 'london winter open');
  expectOpen(bj(2026, 1, 16, 0, 45), 'london', '开盘中', '16:00–次日01:00', 'london winter late');
  expectClosed(bj(2026, 1, 16, 1, 5), 'london', '16:00–次日01:00', 'london winter closed');
}

// --- 欧亚 Globex：美东 18:00-次日 17:00，日切 17:00-18:00 ---
{
  expectOpen(bj(2026, 7, 15, 10, 0), 'eurasia', '开盘中', '06:00–次日05:00', 'globex summer');
  expectClosed(bj(2026, 7, 15, 5, 30), 'eurasia', '06:00–次日05:00', 'globex summer halt');
  expectOpen(bj(2026, 1, 15, 10, 0), 'eurasia', '开盘中', '07:00–次日06:00', 'globex winter');
  expectClosed(bj(2026, 1, 15, 6, 30), 'eurasia', '07:00–次日06:00', 'globex winter halt');
}

// --- 日本 JPX：日盘 08:45-15:45、夜盘 17:00-06:00 东京 = 北京减 1 小时 ---
{
  expectOpen(bj(2026, 3, 16, 10, 0), 'japan', '开盘中', '07:45–14:45', 'jpx day');
  expectClosed(bj(2026, 3, 16, 15, 0), 'japan', '16:00–次日05:00', 'jpx between');
  expectOpen(bj(2026, 3, 16, 17, 0), 'japan', '夜盘中', '16:00–次日05:00', 'jpx night');
}

// --- 美盘 COMEX 场内 08:20-13:30 美东 ---
{
  expectOpen(bj(2026, 7, 15, 21, 0), 'comex', '开盘中', '20:20–次日01:30', 'comex summer');
  expectClosed(bj(2026, 7, 15, 19, 0), 'comex', '20:20–次日01:30', 'comex summer before');
  expectOpen(bj(2026, 1, 15, 22, 0), 'comex', '开盘中', '21:20–次日02:30', 'comex winter');
}

// --- 美股 09:30-16:00 美东；感恩节次日提早 13:00 ---
{
  expectOpen(bj(2026, 7, 15, 22, 0), 'nyse', '开盘中', '21:30–次日04:00', 'nyse summer');
  expectOpen(bj(2026, 1, 15, 23, 0), 'nyse', '开盘中', '22:30–次日05:00', 'nyse winter');
  const early = venueState('nyse', fromZoned('America/New_York', 2026, 11, 27, 12, 0, 0));
  assert(early.open === true, 'nyse early close still open at 12:00 ET');
  assert(fmtRange(early.start, early.end) === '22:30–次日02:00', 'nyse thanksgiving friday 13:00 ET');
  const after = venueState('nyse', fromZoned('America/New_York', 2026, 11, 27, 13, 5, 0));
  assert(after.open === false, 'nyse early close done at 13:05 ET');
}

// --- 周末：沪金/上金/欧盘/美股均休；欧亚周日晚开 ---
{
  expectClosed(bj(2026, 3, 14, 10, 0), 'shfe', null, 'saturday shfe');
  expectClosed(bj(2026, 3, 14, 10, 0), 'sge', null, 'saturday sge');
  expectClosed(bj(2026, 3, 14, 10, 0), 'london', null, 'saturday london');
  expectClosed(bj(2026, 3, 14, 10, 0), 'nyse', null, 'saturday nyse');
  expectClosed(bj(2026, 3, 15, 10, 0), 'eurasia', '06:00–次日05:00', 'sunday morning globex still closed');
  expectOpen(bj(2026, 3, 16, 7, 0), 'eurasia', '开盘中', '06:00–次日05:00', 'sunday night globex');
}

console.log('PASS session-hours');
