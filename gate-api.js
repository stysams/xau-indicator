'use strict';

const API_HOST = process.env.GATE_API_HOST === undefined
  ? 'api.gateio.ws' : process.env.GATE_API_HOST;

if (API_HOST.length > 253 || !API_HOST.split('.').every((label) =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
  throw new Error('GATE_API_HOST 仅接受主机名，例如 www.gatenode.cash；不要包含协议、端口或路径');
}

const PAGE_API_HOSTS = new Set(['api.gateio.ws', 'www.gatenode.cash']);

function pageApiHost(host) {
  if (host === undefined) return API_HOST;
  if (!PAGE_API_HOSTS.has(host)) throw new Error('不支持的行情域名');
  return host;
}

function parseJson(body, host = API_HOST) {
  try {
    return JSON.parse(body);
  } catch (_) {
    throw new Error('上游 ' + host + ' 返回非 JSON，可能遇到网站验证页面，请切换行情域名或检查 GATE_API_HOST');
  }
}

module.exports = { API_HOST, pageApiHost, parseJson };
