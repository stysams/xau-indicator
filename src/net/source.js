const SOURCE_KEY = 'gold-minute-api-host';
const HOSTS = ['default', 'api.gateio.ws', 'www.gatenode.cash'];

export function readApiSource() {
  try {
    const saved = localStorage.getItem(SOURCE_KEY);
    if (HOSTS.includes(saved)) return saved;
  } catch (_) {}
  return 'default';
}

// Capture per page so other tabs cannot change the source of in-flight loads.
const source = readApiSource();

export function apiSourceHeaders() {
  return source === 'default' ? {} : { 'X-Gate-API-Host': source };
}

export function bindApiSource(select, onError) {
  if (!select) return;
  select.value = source;
  select.addEventListener('change', () => {
    const next = select.value;
    if (!HOSTS.includes(next) || next === source) return;
    try {
      localStorage.setItem(SOURCE_KEY, next);
    } catch (_) {
      select.value = source;
      onError('无法保存行情域名，请允许浏览器使用本地存储后重试。');
      return;
    }
    // A fresh page discards old requests, candles and WebSocket callbacks together.
    location.reload();
  });
}
