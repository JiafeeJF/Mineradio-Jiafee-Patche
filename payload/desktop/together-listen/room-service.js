'use strict';

const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { PROTOCOL, OPEN, TcpFrameSocket } = require('./tcp-transport');
const { AuthoritativeRoom } = require('./authoritative-room');
const { TYPES, validateEnvelope } = require('./protocol');

function isLanRemoteAddress(input) {
  let address = String(input || '').trim().toLowerCase();
  const zoneIndex = address.indexOf('%');
  if (zoneIndex >= 0) address = address.slice(0, zoneIndex);
  if (address.startsWith('::ffff:')) address = address.slice(7);
  if (!address || address === '::1' || /^127\./.test(address)) return false;
  if (/^10\./.test(address) || /^169\.254\./.test(address) || /^192\.168\./.test(address)) return true;
  const ipv4 = address.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    return (first === 172 && second >= 16 && second <= 31)
      || (first === 100 && second >= 64 && second <= 127);
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/.test(address);
}

class RoomService {
  constructor({ serverId, name, authorizationCode, port = 0, host = '0.0.0.0', allowLanWithoutAuthorization = true, onTrace = null }) {
    this.serverId = serverId;
    this.name = name;
    this.port = port;
    this.host = host;
    this.authorizationCode = String(authorizationCode || '');
    if (!/^\d{6}$/.test(this.authorizationCode)) throw new Error('AUTHORIZATION_CODE_INVALID');
    this.allowLanWithoutAuthorization = allowLanWithoutAuthorization !== false;
    this.server = null;
    this.httpServer = null;
    this.wss = null;
    this.clients = new Map();
    this.connections = new Set();
    this.failedAuthorizations = new Map();
    this.expressionTimers = new Map();
    this.progressTimer = null;
    this.lastPairKey = '';
    this.onTrace = typeof onTrace === 'function' ? onTrace : null;
    this.room = new AuthoritativeRoom({ serverId: this.serverId, name });
  }

  async start() {
    if (this.server) return this.address();
    this.httpServer = http.createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/status') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ service: 'mineradio-together', serverId: this.serverId, name: this.name, members: this.clients.size, maxMembers: 2 }));
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"NOT_FOUND"}');
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: { threshold: 1024 } });
    this.httpServer.on('upgrade', (request, socket, head) => {
      let url;
      try { url = new URL(request.url, 'ws://localhost'); } catch (_) { socket.destroy(); return; }
      const upgradeHeader = String(request.headers.upgrade || '').toLowerCase();
      const connectionHeader = String(request.headers.connection || '').toLowerCase();
      this.trace('upgrade', {
        action: 'UPGRADE',
        result: `path=${url.pathname};upgrade=${upgradeHeader};connection=${connectionHeader};remote=${String(request.socket.remoteAddress || 'unknown')}`,
      });
      if (!['/together', '/test'].includes(url.pathname)) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      if (upgradeHeader !== 'websocket' || !connectionHeader.includes('upgrade')) {
        socket.write('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nUpgrade: websocket\r\n\r\n');
        socket.destroy();
        return;
      }
      if (url.pathname === '/test') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          ws.send(JSON.stringify({ status: 'ok', websocket: true, service: 'mineradio-together' }), () => ws.close(1000, 'TEST_OK'));
        });
        return;
      }
      const status = this.authorizationStatus(String(request.socket.remoteAddress || 'unknown'), request.headers['x-mineradio-authorization']);
      if (status !== 200) {
        socket.write(`HTTP/1.1 ${status} ${status === 429 ? 'Too Many Requests' : 'Unauthorized'}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n`);
        socket.destroy();
        return;
      }
      if (this.connections.size >= 2) {
        socket.write('HTTP/1.1 503 Room Full\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit('connection', ws, request));
    });
    this.wss.on('connection', (ws) => this.bindClient(ws));
    this.server = net.createServer((socket) => this.routeSocket(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
    this.port = this.server.address().port;
    this.progressTimer = setInterval(() => {
      if (!this.clients.size || !this.room.state.playing) return;
      this.room.advanceClock();
      this.broadcastState('', 'server', false, true, TYPES.HEARTBEAT);
    }, 1000);
    return this.address();
  }

  address() { return { port: this.port, host: this.host, serverId: this.serverId, name: this.name }; }

  routeSocket(socket) {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => socket.destroy(), 5000);
    const onData = (chunk) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
      if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'GET ') {
        clearTimeout(timeout);
        socket.removeListener('data', onData);
        socket.pause();
        socket.unshift(buffer);
        this.httpServer.emit('connection', socket);
        socket.resume();
        return;
      }
      if (buffer.length > 8192) {
        clearTimeout(timeout);
        socket.end(`${PROTOCOL} 400 INVALID_HANDSHAKE\n`);
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.removeListener('data', onData);
      const line = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
      const remainder = buffer.subarray(newline + 1);
      this.acceptTcpSocket(socket, line, remainder);
    };
    socket.on('data', onData);
  }

  acceptTcpSocket(socket, line, remainder) {
    const remoteAddress = String(socket.remoteAddress || 'unknown');
    if (line === `${PROTOCOL} PROBE`) {
      const status = JSON.stringify({ service: 'mineradio-together', serverId: this.serverId, name: this.name, members: this.clients.size, maxMembers: 2 });
      socket.end(`${PROTOCOL} 200 OK ${status}\n`);
      return;
    }
    const match = line.match(/^MINERADIO\/1 AUTH(?: (\d{6}))?$/);
    if (!match) {
      socket.end(`${PROTOCOL} 400 INVALID_HANDSHAKE\n`);
      return;
    }
    const authStatus = this.authorizationStatus(remoteAddress, match[1]);
    if (authStatus !== 200) {
      socket.end(`${PROTOCOL} ${authStatus} ${authStatus === 429 ? 'AUTHORIZATION_RATE_LIMIT' : 'AUTHORIZATION_FAILED'}\n`);
      return;
    }
    if (this.connections.size >= 2) {
      socket.end(`${PROTOCOL} 503 ROOM_FULL\n`);
      return;
    }
    socket.write(`${PROTOCOL} 200 OK\n`);
    const peer = new TcpFrameSocket(socket, { open: true, initialData: remainder, maxPayload: 64 * 1024 });
    this.bindClient(peer);
  }

  authorizationStatus(remoteAddress, suppliedCode) {
    if (this.allowLanWithoutAuthorization && isLanRemoteAddress(remoteAddress)) {
      this.failedAuthorizations.delete(remoteAddress);
      return 200;
    }
    const suppliedBuffer = Buffer.from(String(suppliedCode || ''));
    const expectedBuffer = Buffer.from(this.authorizationCode);
    const authorized = suppliedBuffer.length === expectedBuffer.length
      && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
    if (!authorized) return this.recordAuthorizationFailure(remoteAddress);
    this.failedAuthorizations.delete(remoteAddress);
    return 200;
  }

  recordAuthorizationFailure(remoteAddress) {
    const now = Date.now();
    const previous = this.failedAuthorizations.get(remoteAddress);
    const entry = !previous || now - previous.startedAt > 60000
      ? { startedAt: now, count: 0 }
      : previous;
    entry.count += 1;
    this.failedAuthorizations.set(remoteAddress, entry);
    return entry.count >= 8 ? 429 : 401;
  }

  bindClient(ws) {
    if (ws._socket) {
      ws._socket.setNoDelay(true);
      ws._socket.setKeepAlive(true, 15000);
    }
    this.connections.add(ws);
    const meta = {
      senderId: '', name: '听众', avatar: 'default:signal', status: 'idle', latencyMs: 0,
      expression: null, lastExpressionAt: 0, joinedAt: Date.now(), rateStartedAt: Date.now(), rateCount: 0,
    };
    ws.on('message', (data, isBinary) => {
      if (isBinary || data.length > 64 * 1024) return ws.close(1009, 'MESSAGE_TOO_LARGE');
      const now = Date.now();
      if (now - meta.rateStartedAt > 10000) { meta.rateStartedAt = now; meta.rateCount = 0; }
      meta.rateCount += 1;
      if (meta.rateCount > 80) return ws.close(1008, 'RATE_LIMIT');
      let raw;
      try { raw = JSON.parse(data.toString('utf8')); } catch (_) { return this.sendError(ws, 'INVALID_JSON'); }
      const checked = validateEnvelope(raw);
      if (!checked.ok) return this.sendError(ws, checked.error);
      const message = checked.value;
      this.trace('receive', { operationId: message.operationId, stateVersion: message.stateVersion, trackId: message.payload && message.payload.trackId, action: message.type, result: 'validated' });
      if (message.serverId && message.serverId !== this.serverId) return this.sendError(ws, 'SERVER_MISMATCH');
      if (!meta.senderId) {
        if (message.type !== TYPES.HELLO && message.type !== TYPES.JOIN_ROOM) return this.sendError(ws, 'HELLO_REQUIRED');
        if ([...this.clients.values()].some((item) => item.senderId === message.senderId)) return this.sendError(ws, 'DUPLICATE_CLIENT');
        meta.senderId = message.senderId;
        meta.name = String(message.payload.name || '听众').slice(0, 48);
        meta.avatar = this.sanitizeAvatar(message.payload.avatar);
        this.clients.set(ws, meta);
        const membership = this.updateMembers();
        const pairReset = this.resetForNewPair(message.operationId || '', meta.senderId);
        if (pairReset) this.broadcastState(message.operationId || '', meta.senderId, false, false, 'SESSION_RESET');
        else if (membership.go) this.broadcastGo(message.operationId || '', meta.senderId);
        else this.broadcastState(message.operationId || '', meta.senderId, false, false, message.type);
        return;
      }
      if (message.senderId !== meta.senderId) return this.sendError(ws, 'SENDER_MISMATCH');
      if (message.type === TYPES.HEARTBEAT) {
        ws.send(JSON.stringify(this.envelope(TYPES.HEARTBEAT, message.operationId || '', {
          serverTimestamp: now,
          clientTimestamp: Number(message.payload.clientTimestamp) || 0,
        })));
        return;
      }
      if (message.type === TYPES.LEAVE_ROOM) return ws.close(1000, 'LEFT_ROOM');
      if (message.type === TYPES.PRESENCE) {
        const allowed = new Set(['idle', 'loading', 'ready', 'playing', 'paused', 'seeking', 'switching', 'buffering', 'waiting', 'error']);
        const status = String(message.payload.status || '');
        if (status && allowed.has(status)) meta.status = status;
        if (message.payload.name != null) meta.name = String(message.payload.name || '听众').trim().slice(0, 48) || '听众';
        if (message.payload.avatar != null) meta.avatar = this.sanitizeAvatar(message.payload.avatar);
        if (Number.isFinite(Number(message.payload.latencyMs))) meta.latencyMs = Math.max(0, Math.min(9999, Math.round(Number(message.payload.latencyMs))));
        this.updateMembers();
        this.broadcastState(message.operationId, meta.senderId, false, false, TYPES.PRESENCE);
        return;
      }
      if (message.type === TYPES.MESSAGE_SEND) {
        const normalizedText = String(message.payload.text || '').replace(/[\r\n\t]+/g, ' ').trim();
        if (Array.from(normalizedText).length > 50) return this.sendError(ws, 'MESSAGE_TOO_LONG', message.operationId);
        const text = normalizedText;
        if (!text) return this.sendError(ws, 'EMPTY_MESSAGE', message.operationId);
        if (Buffer.byteLength(text, 'utf8') > 240) return this.sendError(ws, 'MESSAGE_TOO_LONG', message.operationId);
        if (now - meta.lastExpressionAt < 1800) return this.sendError(ws, 'MESSAGE_RATE_LIMIT', message.operationId);
        meta.lastExpressionAt = now;
        meta.expression = { text, time: now, expiresAt: now + 8000 };
        this.scheduleExpressionExpiry(ws, meta);
        this.updateMembers();
        this.broadcastExpression(meta, message.operationId);
        this.broadcastState(message.operationId, meta.senderId, false, false, TYPES.MESSAGE_SEND);
        return;
      }
      const result = this.room.apply(message);
      if (result.error) {
        this.trace('apply', { operationId: message.operationId, stateVersion: this.room.state.version, trackId: this.room.state.currentTrackId, action: message.type, result: result.error });
        return this.sendError(ws, result.error, message.operationId);
      }
      this.trace('apply', { operationId: message.operationId, stateVersion: this.room.state.version, trackId: this.room.state.currentTrackId, action: message.type, result: result.duplicate ? 'duplicate' : (result.changed ? 'changed' : 'unchanged') });
      if (result.go) this.broadcastGo(message.operationId, meta.senderId);
      else this.broadcastState(message.operationId, meta.senderId, result.duplicate, false, message.type);
    });
    ws.on('close', () => {
      this.connections.delete(ws);
      if (this.expressionTimers.has(ws)) clearTimeout(this.expressionTimers.get(ws));
      this.expressionTimers.delete(ws);
      if (this.clients.delete(ws)) {
        const membership = this.updateMembers();
        if (membership.go) this.broadcastGo('', 'server');
        else this.broadcastState('', 'server', false, false, TYPES.PRESENCE);
      }
    });
  }

  updateMembers() { return this.room.setMembers([...this.clients.values()]); }

  resetForNewPair(operationId, senderId) {
    if (this.clients.size !== 2) return false;
    const pairKey = [...this.clients.values()].map((item) => item.senderId).sort().join('|');
    if (!pairKey || pairKey === this.lastPairKey) return false;
    this.lastPairKey = pairKey;
    this.room.resetForNewPair(operationId, senderId);
    this.trace('session-reset', { operationId, stateVersion: this.room.state.version, action: 'SESSION_RESET', result: pairKey });
    return true;
  }

  sanitizeAvatar(value) {
    const avatar = String(value || 'default:signal');
    if (/^default:(?:signal|rose|mono|mint)$/.test(avatar)) return avatar;
    if (avatar.length <= 24000 && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(avatar)) return avatar;
    return 'default:signal';
  }

  scheduleExpressionExpiry(ws, meta) {
    if (this.expressionTimers.has(ws)) clearTimeout(this.expressionTimers.get(ws));
    const expectedExpiry = meta.expression.expiresAt;
    const timer = setTimeout(() => {
      this.expressionTimers.delete(ws);
      if (!meta.expression || meta.expression.expiresAt !== expectedExpiry) return;
      meta.expression = null;
      this.updateMembers();
      this.broadcastState('', 'server', false, false, TYPES.MESSAGE_SEND);
    }, Math.max(0, expectedExpiry - Date.now()));
    this.expressionTimers.set(ws, timer);
  }

  sendError(ws, code, operationId = '') {
    if (ws.readyState !== OPEN) return;
    ws.send(JSON.stringify(this.envelope(TYPES.ERROR, operationId, { code })));
  }

  envelope(action, operationId, payload, source = 'remote') {
    const version = Number(this.room.state.version) || 0;
    return {
      id: crypto.randomBytes(12).toString('base64url'),
      operationId: String(operationId || ''),
      senderId: 'server',
      serverId: this.serverId,
      timestamp: Date.now(),
      version,
      stateVersion: version,
      action,
      type: action,
      source,
      payload: payload || {},
    };
  }

  broadcastState(operationId = '', senderId = 'server', duplicate = false, progressSnapshot = false, causeAction = '') {
    const normalizedCause = String(causeAction || this.room.state.lastAction || '');
    const message = JSON.stringify(this.envelope(TYPES.ROOM_STATE, operationId, {
      state: this.room.snapshot(),
      acceptedSenderId: senderId,
      action: normalizedCause,
      causeAction: normalizedCause,
      duplicate: !!duplicate,
      progressSnapshot: !!progressSnapshot,
    }));
    this.trace('broadcast-state', { operationId, stateVersion: this.room.state.version, trackId: this.room.state.currentTrackId, action: normalizedCause, result: duplicate ? 'duplicate' : 'sent' });
    for (const ws of this.clients.keys()) if (ws.readyState === OPEN) ws.send(message);
  }

  broadcastGo(operationId = '', senderId = 'server') {
    const state = this.room.snapshot();
    const message = JSON.stringify(this.envelope(TYPES.GO, operationId, {
        state,
        acceptedSenderId: senderId,
        action: state.lastAction,
        transitionId: state.transition ? state.transition.id : '',
        playAt: state.playAt,
      }));
    for (const ws of this.clients.keys()) if (ws.readyState === OPEN) ws.send(message);
  }

  trace(stage, data = {}) {
    if (!this.onTrace) return;
    this.onTrace({ stage, time: Date.now(), ...data });
  }

  broadcastExpression(meta, operationId = '') {
    const expression = meta.expression;
    if (!expression) return;
    const message = JSON.stringify(this.envelope(TYPES.MESSAGE_SEND, operationId, {
      userId: meta.senderId,
      text: expression.text,
      time: expression.time,
      expiresAt: expression.expiresAt,
    }));
    for (const ws of this.clients.keys()) if (ws.readyState === OPEN) ws.send(message);
  }

  async stop(reason = 'ROOM_CLOSED') {
    if (!this.server) return;
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
    for (const ws of this.connections) {
      this.sendError(ws, reason);
      try { ws.close(1001, reason); } catch (_) { }
    }
    this.clients.clear();
    this.connections.clear();
    this.failedAuthorizations.clear();
    for (const timer of this.expressionTimers.values()) clearTimeout(timer);
    this.expressionTimers.clear();
    await new Promise((resolve) => this.wss.close(() => this.server.close(resolve)));
    this.wss = null;
    this.httpServer = null;
    this.server = null;
  }
}

module.exports = { RoomService, isLanRemoteAddress };
