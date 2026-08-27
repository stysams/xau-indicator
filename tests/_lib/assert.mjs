export function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg || 'assertion failed');
    err.name = 'AssertionError';
    throw err;
  }
}

/** 相对/绝对容差：|a-b| <= atol + rtol*|expected| */
export function approx(actual, expected, opts) {
  const atol = (opts && opts.atol != null) ? opts.atol : 1e-9;
  const rtol = (opts && opts.rtol != null) ? opts.rtol : 1e-9;
  const label = (opts && opts.label) || 'approx';
  if (actual == null && expected == null) return;
  if (actual == null || expected == null) {
    assert(false, label + ': got ' + actual + ', want ' + expected);
  }
  const diff = Math.abs(actual - expected);
  const tol = atol + rtol * Math.abs(expected);
  assert(diff <= tol, label + ': got ' + actual + ', want ' + expected + ' (diff=' + diff + ', tol=' + tol + ')');
}

export function assertNull(v, label) {
  assert(v == null, (label || 'value') + ' should be null, got ' + v);
}
