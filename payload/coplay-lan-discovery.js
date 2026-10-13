// ============================================================
//  Jiafee CoPlay v2 — LAN Discovery Service
//  ------------------------------------------------------------
//  UDP broadcast discovery + lightweight HTTP routes for LAN
//  device listing and self-description.
// ============================================================
'use strict';

const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');

const DEFAULTS = {
  udpPort: 9527,
  intervalMs: 2000,
  ttlMs: 6500,
  httpBasePath: '/coplay2/lan',
  signalingPath: '/coplay2/ws',
  displayName: 'Mineradio',
  roomCode: '',
};

function now() { return Date.now(); }

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function getLocalIPv4s() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (!n || n.family !== 'IPv4' || n.internal) continue;
      out.push(n.address);
    }
  }
  return out;
}

function pickPrimaryIp() {
  const ips = getLocalIPv4s();
  return ips[0] || '127.0.0.1';
}

function normalizePort(port) {
  const n = Number(port);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

function createLanDiscovery(opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const peers = new Map();
  const selfId = crypto.randomBytes(8).toString('hex');
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let timer = null;
  let closed = false;
  const state = {
    startedAt: now(),
    self: null,
  };

  function buildSelf() {
    const sessionInfo = typeof opts.getSessionInfo === 'function' ? (opts.getSessionInfo() || {}) : {};
    const code = String(sessionInfo.code || opts.roomCode || '').trim();
    const host = pickPrimaryIp();
    const port = normalizePort(opts.httpPort);
    const wsProto = String(opts.httpProtocol || 'http:') === 'https:' ? 'wss:' : 'ws:';
    const httpProto = String(opts.httpProtocol || 'http:');
    const base = host + ':' + port;
    return {
      id: selfId,
      type: 'coplay2-lan',
      name: String(sessionInfo.name || opts.displayName || 'Mineradio').slice(0, 32),
      ip: host,
      port,
      httpUrl: httpProto + '//' + base,
      wsUrl: wsProto + '//' + base + opts.signalingPath,
      signalingPath: opts.signalingPath,
      inviteCode: code,
      mode: String(sessionInfo.role || 'idle'),
      connected: !!sessionInfo.connected,
      peerName: sessionInfo.peer && sessionInfo.peer.name ? String(sessionInfo.peer.name) : '',
      updatedAt: now(),
      version: 1,
    };
  }

  function refreshSelf() {
    state.self = buildSelf();
    return state.self;
  }

  function updatePeer(payload, rinfo) {
    if (!payload || payload.id === selfId) return null;
    const ip = String(payload.ip || (rinfo && rinfo.address) || '').trim();
    const port = Number(payload.port || (rinfo && rinfo.port) || opts.httpPort || 3000);
    if (!ip) return null;

    const existing = peers.get(payload.id) || {};
    const peer = {
      id: String(payload.id || ip + ':' + port),
      name: String(payload.name || existing.name || 'Mineradio').slice(0, 40),
      ip,
      port,
      httpUrl: String(payload.httpUrl || ('http://' + ip + ':' + port)),
      wsUrl: String(payload.wsUrl || ('ws://' + ip + ':' + port + opts.signalingPath)),
      signalingPath: String(payload.signalingPath || opts.signalingPath),
      inviteCode: String(payload.inviteCode || existing.inviteCode || '').toUpperCase().trim(),
      mode: String(payload.mode || existing.mode || 'idle'),
      connected: !!payload.connected,
      peerName: String(payload.peerName || existing.peerName || ''),
      lastSeen: now(),
      expiresAt: now() + opts.ttlMs,
      version: Number(payload.version || 1),
    };
    peers.set(peer.id, peer);
    return peer;
  }

  function broadcast() {
    if (closed) return;
    const payload = Buffer.from(JSON.stringify(refreshSelf()), 'utf8');
    try {
      socket.send(payload, 0, payload.length, opts.udpPort, '255.255.255.255');
    } catch (_) {}
  }

  function cleanupPeers() {
    const cutoff = now();
    for (const [id, peer] of peers) {
      if (peer.expiresAt && peer.expiresAt < cutoff) peers.delete(id);
    }
  }

  function start() {
    refreshSelf();
    // On startup we do not know about older rooms; drop any cached peer
    // records (they carry stale invite codes from a previous process run).
    peers.clear();
    socket.on('error', (err) => {
      console.warn('[CoPlay2][LAN] UDP error:', err && err.message ? err.message : err);
    });
    socket.on('message', (buf, rinfo) => {
      const payload = safeJsonParse(buf.toString('utf8'));
      if (!payload || payload.type !== 'coplay2-lan') return;
      // Ignore messages from self on the same host (different process/port).
      if (String(payload.ip) === pickPrimaryIp() && Number(payload.port) === Number(opts.httpPort)) return;
      updatePeer(payload, rinfo);
    });
    socket.bind(opts.udpPort, () => {
      try { socket.setBroadcast(true); } catch (_) {}
      try { socket.setTTL(1); } catch (_) {}
      broadcast();
      timer = setInterval(() => {
        cleanupPeers();
        refreshSelf();
        broadcast();
      }, opts.intervalMs);
      if (timer && timer.unref) timer.unref();
      console.log('[CoPlay2][LAN] discovery active on UDP', opts.udpPort);
    });
  }

  function listPeers() {
    cleanupPeers();
    refreshSelf();
    const arr = Array.from(peers.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    return { self: state.self, peers: arr };
  }

  function handleHttpRequest(req, res, pathname) {
    if (!pathname) return false;
    if (pathname === opts.httpBasePath + '/devices' && req.method === 'GET') {
      const body = JSON.stringify(listPeers());
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return true;
    }
    if (pathname === opts.httpBasePath + '/self' && req.method === 'GET') {
      const body = JSON.stringify(refreshSelf());
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return true;
    }
    return false;
  }

  function updateSessionInfo(info) {
    state.self = Object.assign({}, state.self || refreshSelf(), {
      name: String(info && info.name ? info.name : (state.self && state.self.name) || opts.displayName || 'Mineradio').slice(0, 32),
      inviteCode: String(info && info.code ? info.code : (state.self && state.self.inviteCode) || '').toUpperCase().trim(),
      mode: String(info && info.role ? info.role : (state.self && state.self.mode) || 'idle'),
      connected: !!(info && info.connected),
      peerName: info && info.peer && info.peer.name ? String(info.peer.name) : (state.self && state.self.peerName) || '',
      updatedAt: now(),
    });
  }

  function stop() {
    closed = true;
    if (timer) { clearInterval(timer); timer = null; }
    try { socket.close(); } catch (_) {}
    peers.clear();
  }

  return {
    start,
    stop,
    listPeers,
    handleHttpRequest,
    updateSessionInfo,
    getSelf: () => refreshSelf(),
  };
}

module.exports = { createLanDiscovery };
