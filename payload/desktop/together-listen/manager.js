'use strict';

const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns').promises;
const { EventEmitter } = require('events');
const { WebSocket } = require('ws');
const { OPEN, connectTcp, probeTcp } = require('./tcp-transport');
const { RoomService } = require('./room-service');
const { LanDiscovery, DISCOVERY_PORT } = require('./discovery');
const { TogetherConfigStore } = require('./config-store');
const { TYPES, id } = require('./protocol');

const MAX_RECONNECT_ATTEMPTS = 3;

function localIpv4Addresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) if (item.family === 'IPv4' && !item.internal) out.push(item.address);
  }
  return [...new Set(out)];
}

function isPrivateNetworkHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^10\./.test(host) || /^127\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/.test(host);
}

function normalizeConnectTarget(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('请输入 IP:端口 或域名:端口');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `tcp://${raw}`;
  let url;
  try { url = new URL(raw); } catch (_) { throw new Error('连接地址格式错误'); }
  if (!['tcp:', 'ws:', 'wss:'].includes(url.protocol)) throw new Error('仅支持 IP:端口、tcp://、ws:// 或 wss:// 地址');
  const transport = url.protocol === 'tcp:' ? 'tcp' : 'websocket';
  const port = Number(url.port || (url.protocol === 'wss:' ? 443 : (url.protocol === 'ws:' ? 80 : 0)));
  if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须为 1-65535');
  if (transport === 'websocket' && (!url.pathname || url.pathname === '/')) url.pathname = '/together';
  if (transport === 'tcp') url.pathname = '';
  url.search = '';
  const hostForDisplay = url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname;
  return { url: url.toString(), serverId: '', hostname: url.hostname, port, transport, displayAddress: `${hostForDisplay}:${port}` };
}

function normalizeAuthorizationCode(input) {
  const code = String(input || '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error('请输入服务器显示的 6 位授权码');
  return code;
}

function authorizationCodeForTarget(target, input) {
  const code = String(input || '').trim();
  const hostname = String(target && target.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!code && targetAllowsBlankAuthorization(hostname)) return '';
  return normalizeAuthorizationCode(code);
}

function targetAllowsBlankAuthorization(targetOrHostname) {
  const hostname = String(targetOrHostname && targetOrHostname.hostname || targetOrHostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return isPrivateNetworkHost(hostname)
    && !['localhost', '::1'].includes(hostname)
    && !/^127\./.test(hostname);
}

function savedServerForUi(entry) {
  try {
    const target = normalizeConnectTarget(entry && entry.address);
    return { ...entry, requiresAuthorization: !targetAllowsBlankAuthorization(target) };
  } catch (_) {
    return { ...entry, requiresAuthorization: true };
  }
}

function probeHttpUrl(input) {
  const target = normalizeConnectTarget(input);
  if (target.transport !== 'websocket') throw new Error('HTTP_STATUS_NOT_USED_FOR_TCP');
  const wsUrl = new URL(target.url);
  wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
  wsUrl.pathname = '/status';
  wsUrl.search = '';
  return { target, url: wsUrl };
}

class TogetherListenManager extends EventEmitter {
  constructor({ userDataPath }) {
    super();
    this.config = new TogetherConfigStore(userDataPath);
    this.clientId = this.config.data.clientId;
    this.service = null;
    this.socket = null;
    this.target = null;
    this.roomState = null;
    this.connectionState = 'idle';
    this.explicitClose = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pendingHeartbeats = new Map();
    this.processedOperations = new Set();
    this.serverClockOffsetMs = 0;
    this.hasClockSample = false;
    this.needsFullResync = true;
    this.latencyMs = 0;
    this.lastPresenceLatency = -1;
    this.debugEnabled = process.env.MINERADIO_TOGETHER_DEBUG === '1';
    this.debugLog = [];
    this.discovery = new LanDiscovery({ getAdvertisement: () => this.advertisement() });
  }

  emitEvent(kind, payload = {}) { this.emit('event', { kind, ...payload }); }

  trace(stage, data = {}) {
    const entry = {
      time: Date.now(), stage: String(stage || ''), clientId: this.clientId,
      operationId: String(data.operationId || ''), stateVersion: Number(data.stateVersion) || 0,
      trackId: String(data.trackId || ''), action: String(data.action || ''), result: String(data.result || ''),
    };
    this.debugLog.push(entry);
    while (this.debugLog.length > 500) this.debugLog.shift();
    if (this.debugEnabled) console.info('[TogetherListen]', JSON.stringify(entry));
    return entry;
  }

  setDebugMode(enabled) { this.debugEnabled = enabled === true; return this.debugEnabled; }
  getDebugLog() { return this.debugLog.slice(); }

  status() {
    return {
      connectionState: this.connectionState,
      clientId: this.clientId,
      room: this.roomState,
      hosting: !!this.service,
      host: this.service ? this.hostInfo() : null,
      target: this.target ? this.target.displayAddress : '',
      savedServers: this.listSaved(),
      profile: this.config.profile(),
      latencyMs: this.latencyMs,
      transport: this.connectionQuality(),
    };
  }

  connectionQuality() {
    const latencyMs = Math.max(0, Math.round(Number(this.latencyMs) || 0));
    const lan = !!(this.target && isPrivateNetworkHost(this.target.hostname || new URL(this.target.url).hostname));
    let quality = 'measuring';
    let qualityLabel = '检测中';
    let syncProfile = lan ? 'lan' : 'balanced';
    if (latencyMs > 0 && latencyMs <= 30) { quality = 'excellent'; qualityLabel = '低延迟'; syncProfile = 'lan'; }
    else if (latencyMs <= 150 && latencyMs > 0) { quality = 'good'; qualityLabel = '良好'; syncProfile = 'balanced'; }
    else if (latencyMs <= 250 && latencyMs > 0) { quality = 'high'; qualityLabel = '较高延迟'; syncProfile = 'high-latency'; }
    else if (latencyMs > 250) { quality = 'poor'; qualityLabel = '网络较差'; syncProfile = 'high-latency'; }
    return { kind: lan ? 'lan' : 'public', label: lan ? '局域网' : '公网 / 穿透', latencyMs, quality, qualityLabel, syncProfile };
  }

  hostInfo() {
    if (!this.service) return null;
    const ips = localIpv4Addresses();
    return {
      serverId: this.service.serverId, name: this.service.name, port: this.service.port, addresses: ips,
      protocol: 'tcp', discoveryProtocol: 'udp', discoveryPort: DISCOVERY_PORT,
      authorizationCode: this.service.authorizationCode,
      connectionAddresses: ips.map((ip) => `${ip}:${this.service.port}`),
      localAddress: `127.0.0.1:${this.service.port}`,
    };
  }

  advertisement() {
    if (!this.service) return null;
    return { serverId: this.service.serverId, name: this.service.name, port: this.service.port, members: this.service.clients.size, sentAt: Date.now() };
  }

  async createRoom(options = {}) {
    await this.leave({ stopHost: true });
    const name = String(options.name || 'Mineradio 一起听服务器').trim().slice(0, 64) || 'Mineradio 一起听服务器';
    const port = options.port == null || options.port === '' ? 17861 : Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('监听端口必须为 0-65535');
    const authorizationCode = String(crypto.randomInt(100000, 1000000));
    this.service = new RoomService({ serverId: id(16), name, authorizationCode, port, onTrace: (entry) => this.trace(`server:${entry.stage}`, entry) });
    try { await this.service.start(); } catch (error) { this.service = null; if (error && error.code === 'EADDRINUSE') throw new Error('端口已被占用'); throw error; }
    await this.discovery.start().catch(() => {});
    const host = this.hostInfo();
    await this.connect(host.localAddress, { authorizationCode, reconnect: true });
    return this.status();
  }

  async connect(input, options = {}) {
    const normalizedTarget = normalizeConnectTarget(input);
    const authorizationCode = authorizationCodeForTarget(normalizedTarget, options.authorizationCode);
    const target = { ...normalizedTarget, authorizationCode, savedServerId: String(options.savedServerId || '') };
    this.explicitClose = false;
    this.lastPresenceLatency = -1;
    this.latencyMs = 0;
    this.serverClockOffsetMs = 0;
    this.hasClockSample = false;
    this.needsFullResync = true;
    this.target = target;
    this.clearSocket(false);
    this.connectionState = 'connecting';
    this.emitEvent('status', { status: this.status() });
    await new Promise((resolve, reject) => {
      let settled = false;
      const transportSocket = target.transport === 'tcp'
        ? connectTcp({ host: target.hostname, port: target.port, authorizationCode, maxPayload: 64 * 1024 })
        : new WebSocket(target.url, {
          handshakeTimeout: 8000,
          maxPayload: 64 * 1024,
          perMessageDeflate: { threshold: 1024 },
          headers: { 'x-mineradio-authorization': authorizationCode },
        });
      this.socket = transportSocket;
      const timeout = setTimeout(() => { if (!settled) { settled = true; transportSocket.terminate(); if (options.savedServerId) this.markSaved(options.savedServerId, 'offline'); reject(new Error('TCP 连接超时：确认 FRP 使用 type=tcp，并转发开服面板显示的 TCP 监听端口（UDP 17862 仅用于局域网发现）')); } }, 9000);
      transportSocket.once('open', () => {
        if (this.socket !== transportSocket) return;
        clearTimeout(timeout);
        settled = true;
        if (transportSocket._socket) {
          transportSocket._socket.setNoDelay(true);
          transportSocket._socket.setKeepAlive(true, 15000);
        }
        this.connectionState = 'connected';
        this.reconnectAttempt = 0;
        const profile = this.config.profile();
        this.send({ type: TYPES.HELLO, operationId: id(12), payload: { name: profile.name, avatar: profile.avatar } });
        this.startHeartbeat();
        this.emitEvent('status', { status: this.status() });
        resolve(this.status());
      });
      transportSocket.on('message', (data, isBinary) => this.handleMessage(transportSocket, data, isBinary));
      transportSocket.once('handshake-error', (failure) => {
        if (settled) return;
        clearTimeout(timeout);
        settled = true;
        if (this.socket === transportSocket) this.socket = null;
        this.connectionState = 'idle';
        if (options.savedServerId) this.markSaved(options.savedServerId, 'offline');
        const messages = { 400: '该 TCP 端口不是 Mineradio 一起听服务器', 401: '已连到 Mineradio，但授权码错误', 429: '授权码尝试过于频繁，请稍后再试', 503: '服务器人数已满' };
        this.emitEvent('status', { status: this.status() });
        reject(new Error(messages[failure.statusCode] || `一起听 TCP 握手失败 (${failure.code || failure.statusCode})`));
      });
      transportSocket.once('unexpected-response', (_request, response) => {
        if (settled) return;
        clearTimeout(timeout);
        settled = true;
        if (this.socket === transportSocket) this.socket = null;
        this.connectionState = 'idle';
        if (options.savedServerId) this.markSaved(options.savedServerId, 'offline');
        const responseServer = String(response.headers.server || '');
        const messages = { 401: '已连到 Mineradio，但授权码错误', 404: 'TCP 端口可达，但该端口不是 Mineradio 一起听服务；检查 FRP localPort', 426: 'TCP 端口可达，但 WebSocket 升级被代理拦截', 429: '授权码尝试过于频繁，请稍后再试', 501: /sakurafrp/i.test(responseServer) ? 'SakuraFrp 节点拦截了明文 WebSocket 握手：请为隧道启用自动 HTTPS 后使用 wss://，或更换允许明文 WebSocket 的节点' : '中转入口返回 501，WebSocket Upgrade 未到达 Mineradio', 502: 'FRP 节点无法连接本机一起听 TCP 端口', 503: '服务器人数已满，或 FRP 节点的上游暂不可用' };
        response.resume();
        this.emitEvent('status', { status: this.status() });
        reject(new Error(messages[response.statusCode] || `服务器拒绝连接 (${response.statusCode})`));
      });
      transportSocket.on('error', (error) => { if (!settled) { clearTimeout(timeout); settled = true; if (options.savedServerId) this.markSaved(options.savedServerId, 'offline'); const labels = { ECONNREFUSED: 'TCP 端口被拒绝：检查 FRP remotePort、localPort 和防火墙', ENOTFOUND: '找不到服务器域名，请检查 FRP 地址', ETIMEDOUT: 'TCP 连接超时：检查 FRP 隧道是否在线', ECONNRESET: 'TCP 连接被中途重置：检查 FRP localPort 和本地服务器状态' }; reject(new Error(labels[error.code] || `一起听连接失败：${error.message}`)); } });
      transportSocket.on('close', (code, reason) => this.handleClose(transportSocket, code, reason));
    });
    if (options.savedServerId) this.markSaved(options.savedServerId, 'online');
    return this.status();
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== OPEN || !this.target) return false;
    const action = String(message.action || message.type || '').toUpperCase();
    const version = this.roomState ? Number(this.roomState.version) || 0 : 0;
    const envelope = {
      id: String(message.id || id(12)),
      operationId: String(message.operationId || ''),
      serverId: this.target.serverId || (this.roomState && this.roomState.serverId) || '',
      senderId: this.clientId,
      timestamp: Number(message.timestamp) || Date.now(),
      version,
      stateVersion: version,
      action,
      type: action,
      source: ['local', 'system'].includes(message.source) ? message.source : 'local',
      payload: message.payload && typeof message.payload === 'object' ? message.payload : {},
    };
    this.trace('send', { operationId: envelope.operationId, stateVersion: version, trackId: envelope.payload.trackId, action, result: 'queued' });
    this.socket.send(JSON.stringify(envelope));
    return true;
  }

  request(type, payload = {}, source = 'local', requestedOperationId = '') {
    if (this.connectionState !== 'connected') throw new Error('尚未连接一起听服务器');
    const candidate = String(requestedOperationId || '');
    const operationId = /^[A-Za-z0-9_-]{12,128}$/.test(candidate) ? candidate : id(16);
    if (!this.send({ type, operationId, payload, source })) throw new Error('连接不可用');
    return { ok: true, operationId };
  }

  rememberOperation(operationId) {
    const key = String(operationId || '');
    if (!key) return true;
    if (this.processedOperations.has(key)) return false;
    this.processedOperations.add(key);
    while (this.processedOperations.size > 2048) this.processedOperations.delete(this.processedOperations.values().next().value);
    return true;
  }

  handleMessage(ws, data, isBinary) {
    if (ws !== this.socket || isBinary || data.length > 64 * 1024) return;
    let message;
    try { message = JSON.parse(data.toString('utf8')); } catch (_) { return; }
    if ((message.type === TYPES.ROOM_STATE || message.type === TYPES.GO) && message.payload && message.payload.state) {
      const rawState = message.payload.state;
      const operationId = String(message.operationId || '');
      const previousServerId = String(this.roomState && this.roomState.serverId || '');
      const incomingServerId = String(rawState.serverId || message.serverId || '');
      if (previousServerId && incomingServerId && previousServerId !== incomingServerId) {
        this.trace('authority-reset', { operationId, stateVersion: rawState.version, trackId: rawState.currentTrackId, action: 'SERVER_CHANGED', result: `${previousServerId}->${incomingServerId}` });
        this.roomState = null;
        this.processedOperations.clear();
      }
      if (Number(rawState.version) < Number(this.roomState && this.roomState.version || 0)) {
        this.trace('authority-dropped', { operationId, stateVersion: rawState.version, trackId: rawState.currentTrackId, action: message.payload.causeAction, result: 'stale-version' });
        return;
      }
      if (operationId && !this.rememberOperation(operationId)) {
        this.trace('authority-dropped', { operationId, stateVersion: rawState.version, trackId: rawState.currentTrackId, action: message.payload.causeAction, result: 'duplicate-operation' });
        return;
      }
      const state = { ...rawState, receivedAt: Date.now(), clockOffsetMs: this.serverClockOffsetMs };
      if (!this.roomState || Number(state.version) >= Number(this.roomState.version)) {
        this.roomState = state;
        const causeAction = String(message.payload.causeAction || message.payload.action || state.lastAction || '');
        const metadataOnly = !this.needsFullResync && [TYPES.HELLO, TYPES.JOIN_ROOM, TYPES.PRESENCE, TYPES.MESSAGE_SEND].includes(causeAction);
        this.needsFullResync = false;
        this.trace('authority-accepted', { operationId, stateVersion: state.version, trackId: state.currentTrackId, action: causeAction, result: metadataOnly ? 'metadata' : 'playback' });
        this.emitEvent('room-state', {
          state,
          operationId,
          acceptedSenderId: String(message.payload.acceptedSenderId || ''),
          action: causeAction,
          source: String(message.source || 'remote'),
          go: message.type === TYPES.GO,
          progressSnapshot: message.payload.progressSnapshot === true,
          metadataOnly,
        });
      }
    } else if (message.type === TYPES.HEARTBEAT) {
      const startedAt = this.pendingHeartbeats.get(String(message.operationId || ''));
      this.pendingHeartbeats.delete(String(message.operationId || ''));
      if (startedAt) {
        const receivedAt = Date.now();
        this.latencyMs = Math.max(0, receivedAt - startedAt);
        const serverTimestamp = Number(message.payload && message.payload.serverTimestamp) || receivedAt;
        const offsetSample = serverTimestamp - (startedAt + this.latencyMs / 2);
        this.serverClockOffsetMs = this.hasClockSample ? (this.serverClockOffsetMs * 0.8 + offsetSample * 0.2) : offsetSample;
        this.hasClockSample = true;
        if (this.lastPresenceLatency < 0 || Math.abs(this.latencyMs - this.lastPresenceLatency) >= 5) {
          this.lastPresenceLatency = this.latencyMs;
          this.send({ type: TYPES.PRESENCE, operationId: id(8), payload: { latencyMs: this.latencyMs } });
        }
        this.emitEvent('status', { status: this.status() });
      }
    } else if (message.type === TYPES.MESSAGE_SEND) {
      this.emitEvent('message', {
        operationId: String(message.operationId || ''),
        userId: String(message.payload && message.payload.userId || ''),
        text: String(message.payload && message.payload.text || ''),
        time: Number(message.payload && message.payload.time) || 0,
        expiresAt: Number(message.payload && message.payload.expiresAt) || 0,
      });
    } else if (message.type === TYPES.ERROR) {
      const code = String(message.payload && message.payload.code || 'UNKNOWN_ERROR');
      if (code === 'ROOM_CLOSED' || code === 'SERVER_CLOSED') this.explicitClose = true;
      this.emitEvent('error', { code, operationId: String(message.operationId || '') });
    }
  }

  handleClose(ws, code, reason) {
    if (ws !== this.socket) return;
    this.socket = null;
    this.stopHeartbeat();
    this.connectionState = this.explicitClose ? 'idle' : 'disconnected';
    this.emitEvent('status', { status: this.status(), closeCode: code, reason: reason.toString() });
    if (!this.explicitClose && this.target) this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.explicitClose || !this.target || this.reconnectTimer) return;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.finishReconnectFailure();
      return;
    }
    const attempt = ++this.reconnectAttempt;
    const delay = Math.min(15000, 700 * (2 ** Math.min(5, attempt - 1))) + Math.floor(Math.random() * 450);
    this.connectionState = 'reconnecting';
    this.emitEvent('status', { status: this.status(), retryInMs: delay, reconnectAttempt: attempt, reconnectLimit: MAX_RECONNECT_ATTEMPTS });
    const reconnectTarget = this.target;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.target || this.target.url !== reconnectTarget.url) return;
      this.connect(reconnectTarget.url, { authorizationCode: reconnectTarget.authorizationCode, savedServerId: reconnectTarget.savedServerId, reconnect: true })
        .catch(() => this.scheduleReconnect());
    }, delay);
  }

  finishReconnectFailure() {
    const attempts = this.reconnectAttempt;
    const savedServerId = this.target && this.target.savedServerId;
    this.explicitClose = true;
    this.clearSocket(false);
    this.roomState = null;
    this.processedOperations.clear();
    this.target = null;
    this.connectionState = 'idle';
    this.reconnectAttempt = 0;
    this.latencyMs = 0;
    this.lastPresenceLatency = -1;
    if (savedServerId) this.markSaved(savedServerId, 'offline');
    this.emitEvent('error', { code: 'RECONNECT_EXHAUSTED', attempts });
    this.emitEvent('status', { status: this.status(), reconnectExhausted: true, attempts });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    const heartbeat = () => {
      const operationId = id(8);
      this.pendingHeartbeats.set(operationId, Date.now());
      while (this.pendingHeartbeats.size > 8) this.pendingHeartbeats.delete(this.pendingHeartbeats.keys().next().value);
      this.send({ type: TYPES.HEARTBEAT, operationId, payload: { clientTimestamp: Date.now() } });
    };
    heartbeat();
    this.heartbeatTimer = setInterval(heartbeat, 5000);
  }

  stopHeartbeat() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; this.pendingHeartbeats.clear(); }

  clearSocket(explicit = true) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    if (this.socket) { const socket = this.socket; this.socket = null; try { if (explicit && socket.readyState === OPEN) socket.close(1000, 'LEAVE'); else socket.terminate(); } catch (_) { } }
  }

  async leave(options = {}) {
    this.explicitClose = true;
    if (this.socket && this.socket.readyState === OPEN) this.send({ type: TYPES.LEAVE_ROOM, operationId: id(8), payload: {} });
    this.clearSocket(true);
    this.roomState = null;
    this.processedOperations.clear();
    this.target = null;
    this.connectionState = 'idle';
    this.reconnectAttempt = 0;
    if (options.stopHost && this.service) { const service = this.service; this.service = null; await service.stop(); }
    this.emitEvent('status', { status: this.status() });
    return this.status();
  }

  async close() { await this.leave({ stopHost: true }); this.discovery.close(); }
  discover() { return this.discovery.discover(); }
  probe(input) {
    let target;
    try { target = normalizeConnectTarget(input); }
    catch (error) { return Promise.resolve({ online: false, latencyMs: null, error: error.message }); }
    if (target.transport === 'tcp') {
      const startedAt = Date.now();
      return probeTcp({ host: target.hostname, port: target.port, timeoutMs: 2500 })
        .then((data) => ({
          online: data.service === 'mineradio-together',
          latencyMs: Date.now() - startedAt,
          name: String(data.name || ''),
          members: Number(data.members) || 0,
          maxMembers: Number(data.maxMembers) || 2,
        }))
        .catch((error) => ({ online: false, latencyMs: null, error: error.code || error.message }));
    }
    return new Promise((resolve) => {
      let parsed;
      try { parsed = probeHttpUrl(input); } catch (error) { resolve({ online: false, latencyMs: null, error: error.message }); return; }
      const startedAt = Date.now();
      const transport = parsed.url.protocol === 'https:' ? https : http;
      const request = transport.get(parsed.url, { timeout: 2500, headers: { accept: 'application/json' } }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { if (body.length < 8192) body += chunk; });
        response.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (response.statusCode !== 200 || data.service !== 'mineradio-together') throw new Error('NOT_MINERADIO_SERVER');
            resolve({ online: true, latencyMs: Date.now() - startedAt, name: String(data.name || ''), members: Number(data.members) || 0, maxMembers: Number(data.maxMembers) || 2 });
          } catch (error) { resolve({ online: false, latencyMs: null, error: error.message }); }
        });
      });
      request.on('timeout', () => request.destroy(new Error('TIMEOUT')));
      request.on('error', (error) => resolve({ online: false, latencyMs: null, error: error.code || error.message }));
    });
  }

  async diagnose(input, options = {}) {
    const target = normalizeConnectTarget(input);
    const authorizationCode = authorizationCodeForTarget(target, options.authorizationCode);
    const port = target.port;
    const result = { target: target.displayAddress, transport: target.transport, dns: { ok: false }, tcp: { ok: false }, protocol: { ok: false }, latencyMs: null };
    const dnsStarted = Date.now();
    try {
      const resolved = await dns.lookup(target.hostname);
      result.dns = { ok: true, address: resolved.address, family: resolved.family, durationMs: Date.now() - dnsStarted };
    } catch (error) {
      result.dns = { ok: false, error: error.code || error.message, durationMs: Date.now() - dnsStarted };
      return result;
    }
    const tcpStarted = Date.now();
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect({ host: target.hostname, port });
        const timeout = setTimeout(() => socket.destroy(Object.assign(new Error('TCP_TIMEOUT'), { code: 'ETIMEDOUT' })), 4000);
        socket.once('connect', () => { clearTimeout(timeout); socket.destroy(); resolve(); });
        socket.once('error', (error) => { clearTimeout(timeout); reject(error); });
      });
      result.tcp = { ok: true, durationMs: Date.now() - tcpStarted };
    } catch (error) {
      result.tcp = { ok: false, error: error.code || error.message, durationMs: Date.now() - tcpStarted };
      return result;
    }
    const protocolStarted = Date.now();
    if (target.transport === 'tcp') {
      await new Promise((resolve) => {
        let settled = false;
        const socket = connectTcp({ host: target.hostname, port, authorizationCode, maxPayload: 64 * 1024 });
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          result.protocol = { ...value, durationMs: Date.now() - protocolStarted };
          try { socket.terminate(); } catch (_) { }
          resolve();
        };
        const timer = setTimeout(() => finish({ ok: false, error: 'TCP_PROTOCOL_TIMEOUT' }), 5500);
        socket.once('open', () => {
          result.latencyMs = Date.now() - protocolStarted;
          finish({ ok: true, kind: 'tcp' });
        });
        socket.once('handshake-error', (failure) => {
          const errors = { 400: 'NOT_MINERADIO_PORT', 401: 'AUTHORIZATION_FAILED', 429: 'AUTHORIZATION_RATE_LIMIT', 503: 'ROOM_FULL' };
          finish({ ok: false, statusCode: failure.statusCode, error: errors[failure.statusCode] || failure.code || 'TCP_PROTOCOL_FAILED' });
        });
        socket.once('error', (error) => finish({ ok: false, error: error.code || error.message }));
      });
      this.trace('diagnose', { action: 'CONNECT', result: JSON.stringify({ dns: result.dns.ok, tcp: result.tcp.ok, protocol: result.protocol.ok, transport: target.transport }) });
      return result;
    }
    await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (settled) return; settled = true; result.protocol = { ...value, kind: 'websocket', durationMs: Date.now() - protocolStarted }; result.websocket = result.protocol; resolve(); };
      const ws = new WebSocket(target.url, { handshakeTimeout: 5000, maxPayload: 64 * 1024, headers: { 'x-mineradio-authorization': authorizationCode } });
      const timer = setTimeout(() => { try { ws.terminate(); } catch (_) {} finish({ ok: false, error: 'WEBSOCKET_TIMEOUT' }); }, 5500);
      const finishAndClear = (value) => { clearTimeout(timer); finish(value); };
      ws.once('open', () => { result.latencyMs = Date.now() - protocolStarted; finishAndClear({ ok: true }); ws.close(1000, 'DIAGNOSTIC'); });
      ws.once('unexpected-response', (_request, response) => {
        const statusCode = Number(response.statusCode) || 0;
        const responseServer = String(response.headers.server || '');
        response.resume();
        const diagnosticErrors = {
          401: 'AUTHORIZATION_FAILED', 404: 'NOT_MINERADIO_PORT', 426: 'WEBSOCKET_UPGRADE_BLOCKED',
          429: 'AUTHORIZATION_RATE_LIMIT', 501: /sakurafrp/i.test(responseServer) ? 'SAKURAFRP_PLAIN_WS_BLOCKED' : 'WEBSOCKET_NOT_IMPLEMENTED', 502: 'FRP_UPSTREAM_UNREACHABLE', 503: 'ROOM_FULL_OR_UPSTREAM_UNAVAILABLE',
        };
        finishAndClear({ ok: false, statusCode, responseServer, error: diagnosticErrors[statusCode] || `HTTP_${statusCode}` });
      });
      ws.once('error', (error) => finishAndClear({ ok: false, error: error.code || error.message }));
    });
    this.trace('diagnose', { action: 'CONNECT', result: JSON.stringify({ dns: result.dns.ok, tcp: result.tcp.ok, protocol: result.protocol.ok, transport: target.transport, statusCode: result.protocol.statusCode || 0 }) });
    return result;
  }
  listSaved() { return this.config.list().map(savedServerForUi); }
  getProfile() { return this.config.profile(); }
  saveProfile(value) { return this.config.updateProfile(value || {}); }
  saveServer(value = {}) {
    const target = normalizeConnectTarget(value.address);
    const address = target.transport === 'tcp' ? target.displayAddress : target.url;
    return savedServerForUi(this.config.upsert({ ...value, address }));
  }
  deleteServer(idValue) { return this.config.remove(idValue); }
  markSaved(idValue, status) { const entry = this.config.list().find((item) => item.id === idValue); if (entry) this.config.upsert({ ...entry, lastConnectedAt: Date.now(), lastStatus: status }); }
}

module.exports = { TogetherListenManager, MAX_RECONNECT_ATTEMPTS, normalizeConnectTarget, normalizeAuthorizationCode, authorizationCodeForTarget, targetAllowsBlankAuthorization, savedServerForUi, localIpv4Addresses, isPrivateNetworkHost, probeHttpUrl };
