#!/usr/bin/env node
'use strict';

/**
 * 分钟台本地服务
 * 1. 提供 gold-minute.html
 * 2. 把 /api/v4/tradfi/*、/api/v4/futures/* 转发到 api.gateio.ws
 * 3. 把 /ws/tradfi 转到 fx-ws.gateio.ws/v4/ws/tradfi
 * 4. 把 /ws/futures 转到 fx-ws.gateio.ws/v4/ws/usdt（USDT 永续）
 */

const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8787;
const ROOT = path.resolve(__dirname);
const API_HOST = 'api.gateio.ws';
const API_ALLOW = [/^\/api\/v4\/tradfi(\/|$)/, /^\/api\/v4\/futures(\/|$)/];
const WS_HOST = 'fx-ws.gateio.ws';
const WS_MAP = {
  '/ws/tradfi': '/v4/ws/tradfi',
  '/ws/futures': '/v4/ws/usdt',
};
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0D85ED11';

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function safePath(urlPath) {
  const raw = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  const rel = raw.replace(/^\/+/, '') || 'gold-minute.html';
  const resolved = path.resolve(ROOT, rel);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

function proxyApi(req, res) {
  const incoming = new URL(req.url, 'http://127.0.0.1');
  if (!API_ALLOW.some((re) => re.test(incoming.pathname))) {
    send(res, 404, JSON.stringify({ label: 'NOT_FOUND', message: '只转发 TradFi 与永续公共接口' }), 'application/json; charset=utf-8');
    return;
  }

  const up = https.get(
    {
      host: API_HOST,
      path: incoming.pathname + incoming.search,
      headers: { Accept: 'application/json' },
      timeout: 15000,
    },
    (upRes) => {
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        res.writeHead(upRes.statusCode || 502, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(Buffer.concat(chunks));
      });
    }
  );
  up.on('timeout', () => up.destroy(new Error('上游请求超时(15s)')));
  up.on('error', (err) => {
    send(
      res,
      502,
      JSON.stringify({ label: 'UPSTREAM', message: err && err.message ? err.message : String(err) }),
      'application/json; charset=utf-8'
    );
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(opcode, data, masked) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = (masked ? 0x80 : 0) | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = (masked ? 0x80 : 0) | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = (masked ? 0x80 : 0) | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  if (!masked) return Buffer.concat([header, payload]);
  const mask = crypto.randomBytes(4);
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, out]);
}

class WsReader {
  constructor() {
    this.buf = Buffer.alloc(0);
  }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames = [];
    for (;;) {
      const frame = this.tryRead();
      if (!frame) break;
      frames.push(frame);
    }
    return frames;
  }
  tryRead() {
    if (this.buf.length < 2) return null;
    const b1 = this.buf[1];
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = 2;
    if (len === 126) {
      if (this.buf.length < 4) return null;
      len = this.buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (this.buf.length < 10) return null;
      const big = this.buf.readBigUInt64BE(2);
      if (big > 1024n * 1024n) return { error: true };
      len = Number(big);
      off = 10;
    }
    const maskOff = off;
    if (masked) off += 4;
    if (this.buf.length < off + len) return null;
    let payload = this.buf.subarray(off, off + len);
    if (masked) {
      const mask = this.buf.subarray(maskOff, maskOff + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    const opcode = this.buf[0] & 0x0f;
    this.buf = this.buf.subarray(off + len);
    return { opcode, payload };
  }
}

function connectUpstream(wsPath, onReady, onFrame, onDead) {
  const key = crypto.randomBytes(16).toString('base64');
  const sock = tls.connect({ host: WS_HOST, port: 443, servername: WS_HOST });
  let handshake = Buffer.alloc(0);
  let upgraded = false;
  const reader = new WsReader();
  let dead = false;

  function fail(err) {
    if (dead) return;
    dead = true;
    onDead(err && err.message ? err.message : err);
    try { sock.destroy(); } catch (e) {}
  }

  sock.setNoDelay(true);
  sock.on('secureConnect', () => {
    sock.write(
      'GET ' + wsPath + ' HTTP/1.1\r\n' +
        'Host: ' + WS_HOST + '\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\n' +
        'Sec-WebSocket-Version: 13\r\n' +
        '\r\n'
    );
  });
  sock.on('data', (chunk) => {
    if (dead) return;
    if (!upgraded) {
      handshake = Buffer.concat([handshake, chunk]);
      const idx = handshake.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = handshake.subarray(0, idx).toString('utf8');
      const rest = handshake.subarray(idx + 4);
      if (!/^HTTP\/1\.[01] 101/i.test(head)) {
        fail(new Error(head.split('\r\n')[0] || 'upstream handshake failed'));
        return;
      }
      upgraded = true;
      onReady(sock);
      if (rest.length) reader.push(rest).forEach(onFrame);
      return;
    }
    reader.push(chunk).forEach(onFrame);
  });
  sock.on('error', (err) => fail(err));
  sock.on('close', () => fail(new Error('upstream closed')));
  return sock;
}

function proxyWs(req, socket, head, wsPath) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  socket.setTimeout(0);
  socket.setNoDelay(true);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' +
      wsAccept(key) +
      '\r\n\r\n'
  );
  if (head && head.length) socket.unshift(head);

  const reader = new WsReader();
  let closed = false;
  let upSock = null;
  let ready = false;
  const queue = [];

  function closeBoth(why) {
    if (closed) return;
    closed = true;
    try { if (upSock) upSock.destroy(); } catch (e) {}
    try { socket.end(); } catch (e) {}
  }

  function sendUp(opcode, payload) {
    if (!ready || !upSock) return;
    try { upSock.write(encodeFrame(opcode, payload, true)); } catch (e) { closeBoth(); }
  }

  function sendDown(opcode, payload) {
    try { socket.write(encodeFrame(opcode, payload, false)); } catch (e) { closeBoth(); }
  }

  upSock = connectUpstream(
    wsPath,
    () => {
      ready = true;
      queue.forEach((item) => sendUp(item.opcode, item.payload));
      queue.length = 0;
    },
    (frame) => {
      if (closed || frame.error) { closeBoth('up frame error'); return; }
      if (frame.opcode === 8) { closeBoth('up close opcode'); return; }
      if (frame.opcode === 9) { sendUp(10, frame.payload); return; }
      if (frame.opcode === 10) return;
      if (frame.opcode === 1 || frame.opcode === 2) sendDown(frame.opcode, frame.payload);
    },
    closeBoth
  );

  socket.on('data', (chunk) => {
    const frames = reader.push(chunk);
    for (const frame of frames) {
      if (frame.error) { closeBoth('client frame error'); return; }
      if (frame.opcode === 8) { closeBoth('client close opcode'); return; }
      if (frame.opcode === 9) { sendDown(10, frame.payload); continue; }
      if (frame.opcode === 10) continue;
      if (frame.opcode === 1 || frame.opcode === 2) {
        if (ready) sendUp(frame.opcode, frame.payload);
        else queue.push(frame);
      }
    }
  });
  socket.on('close', () => closeBoth('client socket close'));
  socket.on('error', (err) => closeBoth('client socket error ' + (err && err.message)));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
    return;
  }

  if (req.url.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }

  const file = safePath(req.url === '/' ? '/gold-minute.html' : req.url);
  if (!file) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
      return;
    }
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  });
});

server.on('upgrade', (req, socket, head) => {
  const pathname = String(req.url || '').split('?')[0];
  const wsPath = WS_MAP[pathname];
  if (!wsPath) {
    socket.destroy();
    return;
  }
  proxyWs(req, socket, head, wsPath);
});

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write('分钟台  http://127.0.0.1:' + PORT + '\n');
});
