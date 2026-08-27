import { mkt, state } from '../state.js';

export function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }

export function px(v, d) { return v == null ? '--' : v.toFixed(d == null ? mkt().digits : d); }

export function fmtFunding(v) {
  if (v == null) return '--';
  return (v * 100).toFixed(4) + '%';
}

export function atrFallback(last) {
  return Math.max((last || 0) * 0.0005, mkt().atrFloor);
}

export function pad2(v) { return String(v).padStart(2, '0'); }

export function fmtHms(sec) {
  const d = new Date(sec * 1000);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

export function fmtHm(sec) {
  const d = new Date(sec * 1000);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function fmtMd(sec) {
  const d = new Date(sec * 1000);
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function fmtBarTime(sec) {
  if (state.tf === '1d') return fmtMd(sec);
  if (state.tf === '4h' || state.tf === '1h') return fmtMd(sec) + ' ' + fmtHm(sec);
  return fmtHms(sec);
}

export function fmtAxis(sec) {
  if (state.tf === '10s') return fmtHms(sec);
  if (state.tf === '1d') return fmtMd(sec);
  if (state.tf === '4h') return fmtMd(sec) + ' ' + fmtHm(sec);
  return fmtHm(sec);
}

export function bucket10(nowMs) {
  return Math.floor(nowMs / 10000) * 10;
}

export function fmtClock() {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
