export function svgEl(name, attrs) {
  const n1 = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const k in attrs) n1.setAttribute(k, attrs[k]);
  return n1;
}

export function lineD(arr, x, y) {
  let d = '';
  let started = false;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) continue;
    d += (started ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
    started = true;
  }
  return d;
}

// 分段折线：遇到 null 断开子路径，避免跨空档连线（超级趋势等按段分色的线用）
export function lineSegD(arr, x, y) {
  let d = '';
  let started = false;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) { started = false; continue; }
    d += (started ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
    started = true;
  }
  return d;
}

export function bollAreaD(up, dn, x, y) {
  const u = [];
  const d = [];
  for (let i = 0; i < up.length; i++) {
    if (up[i] == null || dn[i] == null) continue;
    u.push([i, up[i]]);
    d.push([i, dn[i]]);
  }
  if (u.length < 2) return '';
  let path = 'M' + x(u[0][0]).toFixed(1) + ',' + y(u[0][1]).toFixed(1);
  for (let i = 1; i < u.length; i++) path += 'L' + x(u[i][0]).toFixed(1) + ',' + y(u[i][1]).toFixed(1);
  for (let i = d.length - 1; i >= 0; i--) path += 'L' + x(d[i][0]).toFixed(1) + ',' + y(d[i][1]).toFixed(1);
  return path + 'Z';
}
