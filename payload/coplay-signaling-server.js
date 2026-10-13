// ============================================================
//  Jiafee CoPlay v2 — WebRTC Signaling Server
//  ------------------------------------------------------------
//  Lightweight WebSocket relay for SDP/ICE exchange + room
//  management. Two modes:
//    1. attachSignalingServer(httpServer, opts) — piggy-back
//       on an existing http.Server (e.g. Mineradio's server.js)
//       via the 'upgrade' event.
//    2. standaloneServer(opts) — create a standalone http+ws
//       server for public deployment.
//
//  Zero-dependency by design: tries to load the `ws` package
//  first (if the app happens to ship it), otherwise falls back
//  to a bundled minimal RFC6455 WebSocket server. This keeps the
//  patch installable without ever touching Mineradio's
//  package.json / running npm install.
//
//  Protocol: JSON over WebSocket at /coplay2/ws (default).
//  Rooms: 1 host + 1 guest, 4-char invite code (A-Z, 2-9).
// ============================================================
'use strict';

const crypto = require('crypto');
const http = require('http');
const { EventEmitter } = require('events');

const WS_PATH = '/coplay2/ws';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LEN = 4;
const MAX_ROOMS = 256;
const HEARTBEAT_INTERVAL_MS = 20000;
const HEARTBEAT_TIMEOUT_MS = 30000;
const ROOM_GC_INTERVAL_MS = 60000;
const HOST_RETAIN_MS = 60000;

// -------------------------------------------------------------------
//  WebSocket server abstraction (ws package or bundled fallback)
// -------------------------------------------------------------------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Bundled minimal RFC6455 server. Only used when the `ws` package is
// unavailable. Exposes the same surface we rely on:
//   new WsServer({ noServer:true })
//   .on('connection', (ws, req) => …)
//   .handleUpgrade(req, socket, head, cb)
// and per-socket: .on('message'|'close'|'error'), .send(str),
// .close(), .readyState, .OPEN
class MinimalWsServer extends EventEmitter {
  constructor() { super(); }

  handleUpgrade(req, socket, head, callback) {
    // ---- validate handshake ----
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    if (!key || version !== '13') {
      try { socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch (_) {}
      try { socket.destroy(); } catch (_) {}
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    try {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + 'Sec-WebSocket-Accept: ' + accept + '\r\n'
        + '\r\n'
      );
    } catch (_) {
      try { socket.destroy(); } catch (_) {}
      return;
    }

    const ws = new MinimalWs(socket);
    callback(ws);
    if (head && head.length) ws._push(head);
    ws._attach();
  }
}

class MinimalWs extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.readyState = this.OPEN = 1;
    this.CONNECTING = 0;
    this.CLOSING = 2;
    this.CLOSED = 3;
    this._buffer = Buffer.alloc(0);
    this._closed = false;
    this._onData = (chunk) => this._push(chunk);
  }

  _attach() {
    this.socket.on('data', this._onData);
    this.socket.on('close', () => this._finishClose());
    this.socket.on('error', (err) => this.emit('error', err));
    this.socket.setNoDelay && this.socket.setNoDelay(true);
  }

  _push(chunk) {
    if (this._closed) return;
    this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk;
    while (!this._closed) {
      const frame = this._parseFrame();
      if (!frame) return; // need more data
      if (frame.opcode === 0x8) {
        // close
        this.sendClose();
        try { this.socket.end(); } catch (_) {}
        this._closed = true;
        this.emit('close');
        return;
      } else if (frame.opcode === 0x9) {
        // ping -> pong
        const pong = Buffer.from(frame.payload);
        this._writeFrame(0xA, pong);
      } else if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        const data = frame.payload;
        this.emit('message', Buffer.isBuffer(data) ? data : Buffer.from(data));
      }
      // 0x0 (continuation) / 0xA (pong) are ignored for our JSON payloads
    }
  }

  _parseFrame() {
    const buf = this._buffer;
    if (buf.length < 2) return null;
    const b0 = buf[0];
    const b1 = buf[1];
    // fin, rsv, opcode
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      len = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.slice(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + len) return null;
    let payload = buf.slice(offset, offset + len);
    if (maskKey) {
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i % 4];
      payload = out;
    }
    this._buffer = buf.slice(offset + len);
    return { opcode, payload };
  }

  _writeFrame(opcode, payload) {
    if (this._closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, payload])); } catch (_) {}
  }

  send(data) {
    if (this._closed) return;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    this._writeFrame(0x1, payload);
  }

  sendClose(code, reason) {
    let payload = Buffer.alloc(0);
    if (typeof code === 'number') {
      payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      if (reason) payload = Buffer.concat([payload, Buffer.from(String(reason), 'utf8')]);
    }
    this._writeFrame(0x8, payload);
  }

  close(code, reason) {
    if (this._closed) return;
    try { this.sendClose(code, reason); } catch (_) {}
    try { this.socket.end(); } catch (_) {}
    this._closed = true;
    this.readyState = this.CLOSED;
    this.emit('close');
  }

  _finishClose() {
    if (this._closed) return;
    this._closed = true;
    this.readyState = this.CLOSED;
    this.emit('close');
  }
}

// Prefer the `ws` package when present (e.g. if the app ships it);
// otherwise fall back to the bundled minimal implementation.
let WebSocketServerImpl;
try {
  const ws = require('ws');
  WebSocketServerImpl = ws.WebSocketServer || ws.Server;
} catch (_) {
  WebSocketServerImpl = MinimalWsServer;
}

// -------------------------------------------------------------------
//  Core signaling service — room management + message relay
// -------------------------------------------------------------------
function createSignalingService(opts) {
  opts = opts || {};
  const bus = new EventEmitter();
  const rooms = new Map();          // code -> { host, guest, createdAt }
  const peerMeta = new WeakMap();   // ws -> { code, role, name, lastPong }

  // ---- helpers ----
  function now() { return Date.now(); }

  function generateCode() {
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      const bytes = crypto.randomBytes(CODE_LEN);
      for (let i = 0; i < CODE_LEN; i++) {
        code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
      }
      if (!rooms.has(code)) return code;
    }
    return null; // too many attempts
  }

  function send(ws, obj) {
    if (!ws || ws.readyState !== ws.OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (_) { return false; }
  }

  // ---- room operations ----
  function handleCreateRoom(ws, msg) {
    if (rooms.size >= MAX_ROOMS) {
      send(ws, { event: 'error', code: 'ROOM_FULL', msg: '服务器房间已满' });
      return;
    }
    const code = generateCode();
    if (!code) {
      send(ws, { event: 'error', code: 'NO_CODE', msg: '无法生成房间码，请重试' });
      return;
    }
    const peer = { ws, name: String(msg.name || '好友').slice(0, 20), role: 'host', joinedAt: now(), lastPong: now(), disconnectedAt: 0 };
    peerMeta.set(ws, { code, role: 'host', name: peer.name });
    const room = { host: peer, guest: null, createdAt: now(), hostRetained: false };
    rooms.set(code, room);
    send(ws, { event: 'created', code, t: now() });
    bus.emit('room-created', { code, name: peer.name });
  }

  function handleJoinRoom(ws, msg) {
    const code = String(msg.code || '').toUpperCase().trim();
    if (!code || code.length !== CODE_LEN) {
      send(ws, { event: 'error', code: 'BAD_CODE', msg: '邀请码格式错误' });
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      send(ws, { event: 'error', code: 'NOT_FOUND', msg: '房间不存在，请检查邀请码' });
      return;
    }
    if (!room.host && !room.hostRetained) {
      send(ws, { event: 'error', code: 'NO_HOST', msg: '房主已离开，房间已失效' });
      rooms.delete(code);
      return;
    }
    if (room.guest) {
      send(ws, { event: 'error', code: 'FULL', msg: '房间已满（双人已满）' });
      return;
    }
    // If this ws is already in another room, leave it first
    if (peerMeta.has(ws)) {
      handleLeaveRoom(ws, 'overwrite');
    }
    const peer = { ws, name: String(msg.name || '好友').slice(0, 20), role: 'guest', joinedAt: now(), lastPong: now(), waitingForHost: !!room.hostRetained };
    peerMeta.set(ws, { code, role: 'guest', name: peer.name });
    room.guest = peer;

    if (room.host) {
      // Normal join: host present.
      send(room.host.ws, { event: 'peer-joined', peer: { name: peer.name } });
      send(ws, { event: 'joined', code, peer: { name: room.host.name }, t: now(), waiting: false });
    } else {
      // Host is mid-reconnect; guest waits until host resumes.
      send(ws, { event: 'joined', code, peer: null, t: now(), waiting: true });
    }
    bus.emit('room-joined', { code, host: room.host ? room.host.name : null, guest: peer.name });
  }

  function handleResumeRoom(ws, msg) {
    const code = String(msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      send(ws, { event: 'error', code: 'NOT_FOUND', msg: '房间不存在，请重新创建' });
      return;
    }
    if (room.host) {
      send(ws, { event: 'error', code: 'FULL', msg: '房间已有房主' });
      return;
    }
    const peer = { ws, name: String(msg.name || '好友').slice(0, 20), role: 'host', joinedAt: now(), lastPong: now() };
    peerMeta.set(ws, { code, role: 'host', name: peer.name });
    room.host = peer;
    room.hostRetained = false;
    room.retainedAt = 0;
    send(ws, { event: 'resumed', code, t: now() });
    if (room.guest) {
      send(room.guest.ws, { event: 'peer-joined', peer: { name: peer.name } });
    }
    bus.emit('room-resumed', { code });
  }

  function handleLeaveRoom(ws, reason) {
    const meta = peerMeta.get(ws);
    if (!meta) return;
    peerMeta.delete(ws);
    const room = rooms.get(meta.code);
    if (!room) return;
    const role = meta.role;
    if (role === 'host') {
      const explicitLeave = reason === 'user_leave' || reason === 'host_leave' || reason === 'overwrite';
      if (explicitLeave) {
        // Host explicitly left → room is dead; notify guest and close.
        if (room.guest) {
          send(room.guest.ws, { event: 'host-left', reason: reason || 'host_left' });
          peerMeta.delete(room.guest.ws);
        }
        rooms.delete(meta.code);
        bus.emit('room-closed', { code: meta.code });
        return;
      }
      // Transient disconnect: retain the room so host can resume and guest
      // can wait for reconnection instead of losing the session.
      room.host = null;
      room.hostRetained = true;
      room.retainedAt = now();
      if (room.guest) {
        room.guest.waitingForHost = true;
        send(room.guest.ws, { event: 'host-disconnected', code: meta.code });
      }
      bus.emit('room-paused', { code: meta.code });
      return;
    } else if (role === 'guest') {
      room.guest = null;
      if (room.host) {
        send(room.host.ws, { event: 'peer-left', reason: reason || 'guest_left' });
      }
      // Keep room alive for host to re-use or close
      bus.emit('peer-left', { code: meta.code, name: meta.name });
    }
  }

  // ---- signal relay ----
  function traceServer(node, detail) {
    try {
      const stamp = new Date().toISOString();
      console.log('[CoPlay2][TRACE][' + stamp + '][' + node + ']', detail !== undefined ? detail : '');
    } catch (_) {}
  }
  function findRoomBySocket(ws) {
    for (const [code, room] of rooms) {
      if (room.host && room.host.ws === ws) return { code, room, role: 'host' };
      if (room.guest && room.guest.ws === ws) return { code, room, role: 'guest' };
    }
    return null;
  }

  function handleSignal(ws, msg) {
    const meta = peerMeta.get(ws);
    if (!meta) { traceServer('relay:no-meta'); return; }
    let code = meta.code;
    let room = code ? rooms.get(code) : null;
    if (!room) {
      const hit = findRoomBySocket(ws);
      if (hit) {
        code = hit.code;
        room = hit.room;
        traceServer('relay:fallback-room', { code, role: hit.role });
      }
    }
    if (!room) { traceServer('relay:no-room', { code: meta.code }); return; }
    const p = msg.payload || {};
    const target = meta.role === 'host' ? room.guest : room.host;
    if (!target) {
      traceServer('relay:no-peer', { from: meta.role, code: meta.code, type: p.type || 'candidate' });
      send(ws, { event: 'error', code: 'NO_PEER', msg: '对方不在线' });
      return;
    }
    traceServer('relay:forward', { from: meta.role, to: target.role, type: p.type || (p.candidate ? 'candidate' : '?'), code: meta.code, wsOpen: target.ws && target.ws.readyState === target.ws.OPEN });
    send(target.ws, { event: 'signal', payload: msg.payload });
  }

  // ---- heartbeat ----
  function handlePing(ws) {
    const meta = peerMeta.get(ws);
    if (meta) meta.lastPong = now();
    send(ws, { event: 'pong', t: now() });
  }

  function startHeartbeatChecker() {
    const timer = setInterval(() => {
      const cutoff = now() - HEARTBEAT_TIMEOUT_MS;
      for (const [code, room] of rooms) {
        if (room.host && room.host.lastPong < cutoff) {
          try { room.host.ws.close(); } catch(_) {}
          handleLeaveRoom(room.host.ws, 'timeout');
          continue;
        }
        if (room.guest && room.guest.lastPong < cutoff) {
          try { room.guest.ws.close(); } catch(_) {}
          handleLeaveRoom(room.guest.ws, 'timeout');
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    // Do not prevent process exit
    if (timer && timer.unref) timer.unref();
    return timer;
  }

  // ---- room GC (stale empty rooms) ----
  function startRoomGC() {
    const timer = setInterval(() => {
      const cutoff = now() - ROOM_GC_INTERVAL_MS;
      const hostCutoff = now() - HOST_RETAIN_MS;
      for (const [code, room] of rooms) {
        if (room.hostRetained && room.retainedAt && room.retainedAt < hostCutoff) {
          // Host never came back: close the room and release the guest.
          if (room.guest) {
            send(room.guest.ws, { event: 'host-left', reason: 'host_gone' });
            peerMeta.delete(room.guest.ws);
          }
          rooms.delete(code);
          bus.emit('room-closed', { code });
          continue;
        }
        if (!room.host && !room.guest && room.createdAt < cutoff) {
          rooms.delete(code);
        }
      }
    }, ROOM_GC_INTERVAL_MS);
    if (timer && timer.unref) timer.unref();
    return timer;
  }

  // ---- WS connection handler ----
  function handleConnection(ws, req) {
    const ip = req.socket && (req.socket.remoteAddress || 'unknown');
    console.log('[CoPlay2] WS connection from', ip);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); } catch (_) { return; }
      if (!msg || !msg.event) return;

      switch (msg.event) {
        case 'hello': {
          const prev = peerMeta.get(ws) || {};
          peerMeta.set(ws, {
            code: prev.code || null,
            role: prev.role || null,
            name: String(msg.name || prev.name || '').slice(0, 20),
          });
          send(ws, { event: 'welcome', ver: 1, t: now() });
          break;
        }
        case 'createRoom':
          handleCreateRoom(ws, msg);
          break;
        case 'resumeRoom':
          handleResumeRoom(ws, msg);
          break;
        case 'joinRoom':
          handleJoinRoom(ws, msg);
          break;
        case 'leave':
          handleLeaveRoom(ws, msg.reason || 'user_leave');
          break;
        case 'signal':
          handleSignal(ws, msg);
          break;
        case 'ping':
          handlePing(ws);
          break;
        default:
          send(ws, { event: 'error', code: 'UNKNOWN_EVENT', msg: '未知事件类型' });
      }
    });

    ws.on('close', () => {
      handleLeaveRoom(ws, 'ws_close');
      console.log('[CoPlay2] WS closed from', ip, 'rooms remaining:', rooms.size);
    });

    ws.on('error', () => {
      try { ws.close(); } catch(_) {}
    });
  }

  // ---- attach to existing http.Server ----
  function attach(httpServer, attachOpts) {
    const path = attachOpts && attachOpts.path ? attachOpts.path : WS_PATH;
    const wss = new WebSocketServerImpl({ noServer: true });
    httpServer.on('upgrade', (req, socket, head) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== path) return;
      } catch (_) { return; }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
    wss.on('connection', handleConnection);
    const hbTimer = startHeartbeatChecker();
    const gcTimer = startRoomGC();
    console.log('[CoPlay2] signaling attached at', path);
    return { wss, path, hbTimer, gcTimer };
  }

  // ---- status ----
  function getStatus() {
    const out = [];
    for (const [code, room] of rooms) {
      out.push({
        code,
        host: room.host ? { name: room.host.name, joinedAt: room.host.joinedAt } : null,
        guest: room.guest ? { name: room.guest.name, joinedAt: room.guest.joinedAt } : null,
        createdAt: room.createdAt,
      });
    }
    return { rooms: out, count: rooms.size };
  }

  // ---- shutdown ----
  function shutdown() {
    for (const [code, room] of rooms) {
      try {
        if (room.host) { send(room.host.ws, { event: 'server-shutdown' }); room.host.ws.close(); }
        if (room.guest) { send(room.guest.ws, { event: 'server-shutdown' }); room.guest.ws.close(); }
      } catch(_) {}
    }
    rooms.clear();
  }

  return { attach, getStatus, shutdown, bus, rooms };
}

// -------------------------------------------------------------------
//  Standalone public server (for deploy on a VPS / public relay)
// -------------------------------------------------------------------
function standaloneServer(opts) {
  opts = opts || {};
  const port = opts.port || 7890;
  const host = opts.host || '0.0.0.0';

  const server = http.createServer((req, res) => {
    // Health check
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const svc = createSignalingService(opts);
  svc.attach(server, { path: opts.path || WS_PATH });

  server.listen(port, host, () => {
    console.log('[CoPlay2] Standalone signaling server → ws://' + host + ':' + port + (opts.path || WS_PATH));
  });

  return { server, svc };
}

// -------------------------------------------------------------------
//  Exports
// -------------------------------------------------------------------
module.exports = {
  createSignalingService,
  attachSignalingServer: function (httpServer, opts) {
    const svc = createSignalingService(opts);
    const handle = svc.attach(httpServer, opts);
    return { svc, handle };
  },
  standaloneServer,
  WS_PATH,
  MinimalWsServer,
  MinimalWs,
};