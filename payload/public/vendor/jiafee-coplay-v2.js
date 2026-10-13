// ============================================================
//  Jiafee CoPlay v2 — Renderer Core Runtime
//  ------------------------------------------------------------
//  WebRTC DataChannel-based 双人一起听 (Listen Together) engine.
//  Extended for MVP:
//    - LAN discovery via UDP / /coplay2/lan/devices
//    - IP / domain direct connect via ws://host:port/coplay2/ws
//    - Unified session state for equal-control mode
// ============================================================
(function () {
  'use strict';
  if (window.__JIAFEE_COPLAY2__) return;
  window.__JIAFEE_COPLAY2__ = true;

  console.log('[CoPlay2] runtime loaded', new Date().toISOString());

  // ==================================================================
  //  Configuration
  // ==================================================================
  var CONFIG = {
    sigPath: '/coplay2/ws',
    lanPath: '/coplay2/lan',
    lanDiscoveryUrl: '/coplay2/lan/devices',
    sigReconnectBaseMs: 1000,
    sigReconnectMaxMs: 30000,
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
    hostSyncIntervalMs: 900,
    hostTrackPollMs: 160,
    clockIntervalMs: 3500,
    driftThresholdMs: 200,
    driftApplyDeadzoneMs: 100,
    maxClockSamples: 8,
    clockStabilityThresholdMs: 70,
    dcReconnectBaseMs: 500,
    dcReconnectMaxMs: 10000,
    maxQueueSync: 200,
  };

  try {
    var stored = localStorage.getItem('mineradio.coplay2.iceServers');
    if (stored) {
      var parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) CONFIG.iceServers = parsed;
    }
  } catch (_) {}

  // ==================================================================
  //  Utilities
  // ==================================================================
  function now() { return Date.now(); }
  function perfNow() { return (performance && performance.now) ? performance.now() : Date.now(); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function getAudioEl() { return window.audio || null; }
  function getCurrentIdx() { return typeof window.currentIdx === 'number' ? window.currentIdx : -1; }
  function getCurrentTrackId() {
    try {
      var q = window.playQueue;
      var idx = getCurrentIdx();
      if (Array.isArray(q) && idx >= 0 && q[idx]) return String(q[idx].id || q[idx].trackId || q[idx].songId || '');
    } catch (_) {}
    return '';
  }
  function getCurrentTrackMeta() {
    try {
      var q = window.playQueue;
      var idx = getCurrentIdx();
      if (Array.isArray(q) && idx >= 0 && q[idx]) {
        var s = q[idx];
        return {
          id: String(s.id || s.trackId || s.songId || ''),
          name: String(s.name || s.title || ''),
          artist: String(s.artist || s.singer || ''),
          cover: String(s.cover || s.pic || ''),
          source: String(s.source || s.provider || 'netease'),
          duration: Number(s.duration || s.durationMs || 0),
        };
      }
    } catch (_) {}
    return null;
  }
  function getQueueSnapshot() {
    try {
      var q = window.playQueue;
      if (!Array.isArray(q)) return null;
      var max = Math.min(q.length, CONFIG.maxQueueSync);
      var out = new Array(max);
      for (var i = 0; i < max; i++) {
        var s = q[i] || {};
        out[i] = {
          id: String(s.id || s.trackId || s.songId || ''),
          name: String(s.name || s.title || ''),
          artist: String(s.artist || s.singer || ''),
          cover: String(s.cover || s.pic || ''),
          source: String(s.source || s.provider || 'netease'),
        };
      }
      return out;
    } catch (_) { return null; }
  }

  // ==================================================================
  //  Application state
  // ==================================================================
  var sessionSeq = 0;
  var state = {
    role: null,
    code: null,
    sigUrl: null,
    connected: false,
    peer: null,
    peerTrack: null,
    peerPlaying: false,
    clockOffset: 0,
    clockRtt: 0,
    rtt: 0,
    emote: null,
    reconnectAttempt: 0,
    isRemote: false,
    userPaused: false,
    sessionId: 0,
    pendingGuestState: null,
    pendingGuestStateTimer: null,
    lastCorrectionAt: 0,
    lastAppliedTrackId: '',
    localPeerId: 'peer-' + Math.random().toString(16).slice(2, 10),
    lanSelf: null,
    lanDevices: [],
    manualTarget: '',
    directTarget: '',
    directMode: false,
    statusText: '离线',
    lastError: '',
    hostOfferTimer: null,
    hostOfferPending: false,
    pendingRemoteCandidates: [],
    localSnapshotTimer: null,
    hostRetained: false,
  };

  var listeners = {};
  function emit(event, payload) {
    var set = listeners[event];
    if (!set) return;
    set.forEach(function (fn) { try { fn(payload); } catch (_) {} });
  }
  function on(event, fn) {
    if (!listeners[event]) listeners[event] = new Set();
    listeners[event].add(fn);
    return function () { listeners[event].delete(fn); };
  }
  function traceHop(node, detail) {
    try {
      var stamp = new Date().toISOString();
      var s = state || {};
      var head = '[CoPlay2][TRACE][' + stamp + '][' + node + '][role=' + (s.role || '-') + '][code=' + (s.code || '-') + '][dc=' + (s.connected ? 'open' : 'closed') + '][pc=' + (pc ? pc.signalingState + '/' + pc.connectionState : 'none') + ']';
      if (detail !== undefined) console.log(head, detail);
      else console.log(head);
    } catch (_) {}
  }

  // ==================================================================
  //  Signaling client
  // ==================================================================
  function createSignalingClient() {
    var ws = null;
    var url = '';
    var closed = false;
    var reconnectTimer = null;

    function connect(url_) {
      if (closed) return;
      url = url_ || url;
      if (!url) return;
      try {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      } catch (_) { ws = null; }

      try { ws = new WebSocket(url); }
      catch (e) { console.warn('[CoPlay2] WS create failed', e); scheduleReconnect(); return; }

      ws.onopen = function () {
        traceHop('sig:open', { url: url });
        emit('sig:open', url);
        var name = getLocalName();
        if (state.code && state.role) {
          if (state.role === 'host') {
            traceHop('sig:send-resumeRoom', { code: state.code });
            send({ event: 'resumeRoom', code: state.code, name: name });
          } else {
            traceHop('sig:send-joinRoom', { code: state.code });
            send({ event: 'joinRoom', code: state.code, name: name });
          }
        } else {
          send({ event: 'hello', name: name });
          traceHop('sig:send-hello', { name: name });
        }
      };
      ws.onmessage = function (ev) {
        var msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
        traceHop('sig:recv', msg && msg.event ? { event: msg.event, code: msg.code, t: msg.t, waiting: msg.waiting } : { raw: String(ev.data).slice(0, 120) });
        if (msg) handleSigMessage(msg);
      };
      ws.onclose = function () { traceHop('sig:close'); ws = null; emit('sig:close', null); if (!closed) scheduleReconnect(); };
      ws.onerror = function () { traceHop('sig:error'); try { ws.close(); } catch (_) {} };
    }

    function scheduleReconnect() {
      if (closed || reconnectTimer) return;
      var delay = Math.min(CONFIG.sigReconnectBaseMs * Math.pow(2, state.reconnectAttempt), CONFIG.sigReconnectMaxMs);
      state.reconnectAttempt++;
      reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(); }, delay);
    }

    function send(obj) {
      try { if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); return true; } } catch (_) {}
      return false;
    }

    function close() {
      closed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      try { if (ws) ws.close(); } catch (_) {}
      ws = null;
    }

    return { connect: connect, send: send, close: close, get isClosed() { return closed; } };
  }
  var sigClient = createSignalingClient();

  // ==================================================================
  //  Signaling handling
  // ==================================================================
  function handleSigMessage(msg) {
    switch (msg.event) {
      case 'welcome': emit('sig:welcome', msg); break;
      case 'created':
        state.code = msg.code;
        traceHop('sig:created', { code: msg.code });
        emit('room:created', msg);
        startWebRTC();
        break;
      case 'joined':
        state.code = msg.code;
        state.peer = msg.peer || null;
        traceHop('sig:joined', { code: msg.code, peer: msg.peer, waiting: msg.waiting });
        emit('room:joined', msg);
        if (state.role === 'guest') {
          startWebRTC();
          setTimeout(guestSendReady, 120);
        }
        break;
      case 'resumed':
        state.code = msg.code;
        traceHop('sig:resumed', { code: msg.code });
        emit('room:resumed', msg);
        break;
      case 'host-disconnected':
        state.connected = false;
        state.peer = null;
        state.hostRetained = true;
        traceHop('sig:host-disconnected', { code: msg.code });
        emit('host:disconnected', msg);
        try { if (dc) dc.close(); } catch (_) {}
        try { if (pc) pc.close(); } catch (_) {}
        dc = null; pc = null;
        break;
      case 'peer-joined':
        state.peer = msg.peer || null;
        traceHop('sig:peer-joined', { peer: msg.peer });
        emit('peer:joined', msg);
        state.hostRetained = false;
        if (state.role !== 'host' && (!pc || pc.connectionState === 'closed')) startWebRTC();
        break;
      case 'peer-left':
        traceHop('sig:peer-left', { reason: msg.reason });
        emit('peer:left', msg);
        state.peer = null; state.connected = false;
        if (dcReconnectTimer) { clearTimeout(dcReconnectTimer); dcReconnectTimer = null; }
        if (state.role === 'host') {
          if (state.hostOfferTimer) { clearTimeout(state.hostOfferTimer); state.hostOfferTimer = null; }
          state.hostOfferPending = false;
          try { if (dc) dc.close(); } catch (_) {}
          try { if (pc) pc.close(); } catch (_) {}
          dc = null; pc = null;
        }
        break;
      case 'host-left': emit('host:left', msg); cleanupSession('host_left'); break;
      case 'signal': handleSignalRelay(msg.payload); break;
      case 'pong': break;
      case 'server-shutdown': cleanupSession('server_shutdown'); break;
      case 'error':
        console.warn('[CoPlay2] signaling error:', msg.msg);
        state.lastError = msg.msg || 'signaling error';
        emit('sig:error', msg);
        // Host resume failed because the room was GC'd → recreate a fresh room.
        if (state.role === 'host' && msg.code === 'NOT_FOUND') {
          sigClient.send({ event: 'createRoom', name: getLocalName() });
        }
        // The host may have offered too early (guest not fully ready yet).
        // Retry the offer after the guest's ready signal / join settles.
        if (state.role === 'host' && msg.code === 'NO_PEER') {
          if (state.peer) {
            if (state.hostOfferTimer) { clearTimeout(state.hostOfferTimer); state.hostOfferTimer = null; }
            state.hostOfferPending = false;
            setTimeout(function () { if (state.role === 'host' && state.peer) scheduleHostOffer(true); }, 180);
          }
        }
        break;
    }
  }

  // ==================================================================
  //  WebRTC
  // ==================================================================
  var pc = null;
  var dc = null;
  var dcReconnectTimer = null;
  var makingOffer = false;

  function guestSendReady() {
    if (state.role !== 'guest') return;
    traceHop('sig:send-ready', { sessionId: state.sessionId });
    sigClient.send({ event: 'signal', payload: { type: 'ready', ready: true, sessionId: state.sessionId } });
  }

  function clearHostOfferTimer() {
    if (state.hostOfferTimer) { clearTimeout(state.hostOfferTimer); state.hostOfferTimer = null; }
    state.hostOfferPending = false;
  }

  function clearLocalSnapshotTimer() {
    if (state.localSnapshotTimer) { clearTimeout(state.localSnapshotTimer); state.localSnapshotTimer = null; }
  }

  function flushPendingRemoteCandidates() {
    if (!pc || !state.pendingRemoteCandidates.length) return;
    var pending = state.pendingRemoteCandidates.slice();
    state.pendingRemoteCandidates.length = 0;
    pending.forEach(function (cand) {
      try { pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function (err) { if (err && err.name !== 'InvalidStateError') console.warn('[CoPlay2] addIceCandidate failed:', err); }); } catch (_) {}
    });
  }

  function scheduleHostOffer(force) {
    if (state.role !== 'host' || !pc) return;
    if (state.hostOfferPending && !force) return;
    state.hostOfferPending = true;
    clearHostOfferTimer();
    state.hostOfferTimer = setTimeout(function () {
      state.hostOfferTimer = null;
      if (!pc || state.role !== 'host') { state.hostOfferPending = false; return; }
      // Only create an offer when the connection is idle; do not re-offer
      // while we are already waiting for an answer.
      if (pc.signalingState !== 'stable') {
        state.hostOfferPending = false;
        return;
      }
      makingOffer = true;
      pc.createOffer()
        .then(function (offer) { console.log('[CoPlay2][HS] host offer created'); return pc.setLocalDescription(offer); })
        .then(function () {
          var sent = sigClient.send({ event: 'signal', payload: { type: 'offer', sdp: pc.localDescription.sdp } });
          traceHop('sig:offer-sent', { sent: sent, sdpLen: pc.localDescription.sdp.length });
          console.log('[CoPlay2] host offer sent=' + sent, 'sigState=' + pc.signalingState);
        })
        .catch(function (err) { console.error('[CoPlay2] createOffer failed:', err); })
        .finally(function () { makingOffer = false; state.hostOfferPending = false; });
    }, force ? 0 : 120);
  }

  function sendCurrentSnapshotBurst() {
    if (state.role !== 'host' || !state.connected) return;
    clearLocalSnapshotTimer();
    sendTrackSnapshot();
    sendStateSnapshot();
    state.localSnapshotTimer = setTimeout(function () {
      state.localSnapshotTimer = null;
      if (state.role === 'host' && state.connected) {
        sendStateSnapshot();
      }
    }, 350);
  }

  function startWebRTC() {
    sessionSeq++;
    state.sessionId = sessionSeq;
    state.pendingGuestState = null;
    state.pendingRemoteCandidates = [];
    clearHostOfferTimer();
    clearLocalSnapshotTimer();
    if (state.pendingGuestStateTimer) { clearTimeout(state.pendingGuestStateTimer); state.pendingGuestStateTimer = null; }
    if (pc) { try { pc.close(); } catch (_) {} pc = null; dc = null; }
    try { pc = new RTCPeerConnection({ iceServers: CONFIG.iceServers }); }
    catch (e) { console.error('[CoPlay2] RTCPeerConnection create failed:', e); emit('error', { msg: 'WebRTC 初始化失败: ' + (e.message || e) }); return; }

    traceHop('rtc:start', { sessionId: state.sessionId });

    pc.onicecandidate = function (ev) {
      if (ev.candidate) {
        traceHop('rtc:icecandidate', { candidate: ev.candidate.candidate ? ev.candidate.candidate.slice(0, 80) : 'cand' });
        sigClient.send({ event: 'signal', payload: { candidate: ev.candidate.toJSON() } });
      }
    };
    pc.oniceconnectionstatechange = function () {
      var iceState = pc.iceConnectionState;
      traceHop('rtc:ice-state', { iceState: iceState });
      emit('ice:state', iceState);
      if (iceState === 'disconnected' || iceState === 'failed') scheduleDcReconnect();
      else if (iceState === 'connected' || iceState === 'completed') state.reconnectAttempt = 0;
    };
    pc.onconnectionstatechange = function () {
      traceHop('rtc:connection-state', { connState: pc.connectionState });
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') scheduleDcReconnect();
    };
    pc.ondatachannel = function (ev) {
      traceHop('rtc:ondatachannel', { label: ev.channel && ev.channel.label });
      dc = ev.channel;
      setupDataChannel(dc);
    };

    if (state.role === 'host') {
      traceHop('rtc:host-create-dc', { peer: !!state.peer });
      dc = pc.createDataChannel('coplay2', { ordered: true });
      setupDataChannel(dc);
    } else if (state.role === 'guest') {
      traceHop('rtc:guest-pc-ready', { sig: pc.signalingState });
    }
  }

  function setupDataChannel(ch) {
    ch.onopen = function () {
      traceHop('dc:open', { label: ch.label, state: ch.readyState });
      state.connected = true;
      state.reconnectAttempt = 0;
      emit('dc:open', null);
      sendDC({ t: 'HELLO', ver: 1, role: state.role, name: getLocalName(), sessionId: state.sessionId, peerId: state.localPeerId });
      traceHop('dc:send-HELLO', { ver: 1, role: state.role });
      if (state.role === 'host') {
        sendCurrentSnapshotBurst();
        startHostSync();
      }
      startClockSync();
      refreshLanSession();
    };
    ch.onclose = function () {
      traceHop('dc:close', { label: ch.label });
      state.connected = false;
      emit('dc:close', null);
      scheduleDcReconnect();
      refreshLanSession();
    };
    ch.onerror = function () { traceHop('dc:error', { label: ch.label }); try { ch.close(); } catch (_) {} };
    ch.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      traceHop('dc:recv', { t: msg.t });
      handleDCMessage(msg);
    };
  }

  function handleSignalRelay(payload) {
    if (payload && payload.type === 'ready') {
      traceHop('sig:relay-ready', { pc: !!pc, sig: pc ? pc.signalingState : 'none', peer: !!state.peer });
      if (state.role === 'host' && state.peer) {
        if (!pc || pc.signalingState !== 'stable') {
          try { if (pc) pc.close(); } catch (_) {}
          pc = null; dc = null;
          startWebRTC();
          return;
        }
        if (state.hostOfferTimer) { clearTimeout(state.hostOfferTimer); state.hostOfferTimer = null; }
        state.hostOfferPending = false;
        scheduleHostOffer(true);
      }
      return;
    }
    if (!pc) { traceHop('sig:relay-dropped', { type: payload.type }); return; }
    if (payload.type === 'offer' && state.role === 'guest') {
      traceHop('sig:offer-recv', { sig: pc.signalingState, remote: pc.remoteDescription ? pc.remoteDescription.type : 'null' });
      pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }))
        .then(function () {
          traceHop('sig:offer-setRemote-ok');
          flushPendingRemoteCandidates();
          return pc.createAnswer();
        })
        .then(function (answer) {
          traceHop('sig:answer-created');
          return pc.setLocalDescription(answer);
        })
        .then(function () {
          traceHop('sig:answer-local-set');
          sigClient.send({ event: 'signal', payload: { type: 'answer', sdp: pc.localDescription.sdp } });
          traceHop('sig:answer-sent');
        })
        .catch(function (err) { console.error('[CoPlay2] handleOffer failed:', err); });
      return;
    }
    if (payload.type === 'answer' && state.role === 'host') {
      traceHop('sig:answer-recv', { sig: pc.signalingState });
      pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }))
        .then(function () { traceHop('sig:answer-setRemote-ok'); flushPendingRemoteCandidates(); sendCurrentSnapshotBurst(); })
        .catch(function (err) { console.error('[CoPlay2] handleAnswer failed:', err); });
      return;
    }
    if (payload.candidate && payload.candidate.candidate && payload.candidate.sdpMid) {
      if (!pc.remoteDescription) {
        state.pendingRemoteCandidates.push(payload.candidate);
        return;
      }
      pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(function (err) { if (err.name !== 'InvalidStateError') console.warn('[CoPlay2] addIceCandidate failed:', err); });
    }
  }

  function sendDC(obj) {
    if (!dc || dc.readyState !== 'open') return false;
    try {
      dc.send(JSON.stringify(obj));
      traceHop('dc:send', { t: obj.t });
      return true;
    } catch (_) { return false; }
  }

  function handleDCMessage(msg) {
    if (!msg || !msg.t) return;
    switch (msg.t) {
      case 'HELLO':
        if (msg.sessionId) state.sessionId = msg.sessionId;
        emit('status', { connected: true });
        break;
      case 'TRACK': handlePeerTrack(msg.d); break;
      case 'STATE': handlePeerState(msg.d); break;
      case 'PLAY': handlePeerPlay('play', msg.d); break;
      case 'PAUSE': handlePeerPlay('pause', msg.d); break;
      case 'SEEK': handlePeerSeek(msg.d); break;
      case 'CLOCK': handleClockMessage(msg); break;
      case 'EMOTE': state.emote = msg.d ? msg.d.kind : null; emit('emote', msg.d || {}); break;
      case 'QUEUE': handlePeerQueue(msg.d); break;
      case 'BYE': cleanupSession('peer_bye'); break;
      case 'PING': sendDC({ t: 'PONG', d: { t: msg.d ? msg.d.t : 0 } }); break;
      case 'PONG': if (msg.d && msg.d.t) state.rtt = perfNow() - msg.d.t; break;
    }
  }

  // ==================================================================
  //  Clock sync
  // ==================================================================
  var clockSyncTimer = null;
  var clockSamples = [];
  var clockOutstanding = new Map();
  function startClockSync() {
    if (clockSyncTimer) clearInterval(clockSyncTimer);
    setTimeout(sendClockRequest, 500);
    clockSyncTimer = setInterval(sendClockRequest, CONFIG.clockIntervalMs);
  }
  function sendClockRequest() {
    if (!state.connected) return;
    if (clockOutstanding.size >= 3) return;
    var t1 = perfNow();
    var timer = setTimeout(function () { clockOutstanding.delete(t1); }, 3000);
    clockOutstanding.set(t1, timer);
    sendDC({ t: 'CLOCK', d: { dir: 'req', t1: t1 } });
  }
  function handleClockMessage(msg) {
    var d = msg.d; if (!d) return;
    if (d.dir === 'req') { sendDC({ t: 'CLOCK', d: { dir: 'res', t1: d.t1, t2: perfNow(), t3: perfNow() } }); return; }
    if (d.dir === 'res' && clockOutstanding.has(d.t1)) {
      var t1 = d.t1, t2 = d.t2, t3 = d.t3, t4 = perfNow();
      var timer = clockOutstanding.get(t1); if (timer) clearTimeout(timer); clockOutstanding.delete(t1);
      var rtt = (t4 - t1) - (t3 - t2);
      var offset = ((t2 - t1) + (t3 - t4)) / 2;
      if (rtt < CONFIG.clockStabilityThresholdMs * 2) {
        clockSamples.push({ offset: offset, rtt: rtt });
        if (clockSamples.length > CONFIG.maxClockSamples) clockSamples.shift();
        if (clockSamples.length >= 3) {
          var sorted = clockSamples.slice().sort(function (a, b) { return a.offset - b.offset; });
          state.clockOffset = sorted[Math.floor(sorted.length / 2)].offset;
          state.clockRtt = rtt;
        }
        emit('clock', { offset: state.clockOffset, rtt: rtt, samples: clockSamples.length });
      }
    }
  }

  // ==================================================================
  //  Host sync
  // ==================================================================
  var hostSyncTimer = null;
  var hostTrackPollTimer = null;
  var lastTrackId = '';
  function startHostSync() {
    if (hostSyncTimer) clearInterval(hostSyncTimer);
    hostSyncTimer = setInterval(function () { if (state.connected && state.role === 'host') sendStateSnapshot(); }, CONFIG.hostSyncIntervalMs);
    if (hostTrackPollTimer) clearInterval(hostTrackPollTimer);
    hostTrackPollTimer = setInterval(function () {
      if (!state.connected || state.role !== 'host') return;
      var tid = getCurrentTrackId();
      if (tid && tid !== lastTrackId) { lastTrackId = tid; sendTrackSnapshot(); }
    }, CONFIG.hostTrackPollMs);
  }
  function stopHostSync() { if (hostSyncTimer) { clearInterval(hostSyncTimer); hostSyncTimer = null; } if (hostTrackPollTimer) { clearInterval(hostTrackPollTimer); hostTrackPollTimer = null; } }
  function sendTrackSnapshot() {
    var meta = getCurrentTrackMeta(); if (!meta || !state.connected) return;
    var queue = getQueueSnapshot(); var idx = getCurrentIdx(); var audio = getAudioEl();
    lastTrackId = meta.id;
    sendDC({ t: 'TRACK', d: { track: meta, queue: queue, curIdx: idx, pos: audio && isFinite(audio.currentTime) ? audio.currentTime : 0, atMs: perfNow(), at: now() } });
  }
  function sendStateSnapshot() {
    var audio = getAudioEl(); if (!audio || !state.connected) return;
    var meta = getCurrentTrackMeta();
    sendDC({ t: 'STATE', d: { playing: !audio.paused, pos: isFinite(audio.currentTime) ? audio.currentTime : 0, atMs: perfNow(), trackId: meta ? meta.id : '', duration: meta ? meta.duration : 0, userPaused: !!state.userPaused, sessionId: state.sessionId } });
  }

  function scheduleGuestStateFlush() {
    if (state.pendingGuestStateTimer) return;
    state.pendingGuestStateTimer = setTimeout(function () {
      state.pendingGuestStateTimer = null;
      var d = state.pendingGuestState;
      state.pendingGuestState = null;
      if (!d || state.role === 'host' || !state.connected) return;
      applyDriftCorrection(d);
    }, 120);
  }

  function handlePeerState(d) {
    if (!d) return;
    state.peerPlaying = d.playing;
    state.peerTrack = state.peerTrack || {};
    if (d.trackId) state.peerTrack.id = d.trackId;
    if (d.duration) state.peerTrack.duration = d.duration;
    if (typeof d.userPaused === 'boolean') state.userPaused = !!d.userPaused;
    if (state.role === 'host') return;
    if (!d.playing) return;
    state.pendingGuestState = d;
    scheduleGuestStateFlush();
  }

  function applyDriftCorrection(d) {
    var audio = getAudioEl(); if (!audio) return;
    var localTrackId = getCurrentTrackId(); if (!localTrackId || !d.trackId) return;
    if (String(localTrackId) !== String(d.trackId)) return;
    if (audio.paused) return;
    var hostNow = perfNow() + state.clockOffset;
    var expectedPos = d.pos + ((hostNow - d.atMs) / 1000);
    var localPos = isFinite(audio.currentTime) ? audio.currentTime : 0;
    var drift = localPos - expectedPos;
    var settle = perfNow() - state.lastCorrectionAt < 1500;
    var threshold = settle ? 600 : CONFIG.driftThresholdMs;
    if (Math.abs(drift * 1000) <= threshold) return;
    var target = Math.max(0, expectedPos);
    if (target >= audio.duration) return;
    setRemote(function () { audio.currentTime = target; });
    state.lastCorrectionAt = perfNow();
    console.log('[CoPlay2] drift correction: local=' + localPos.toFixed(2) + ' expected=' + expectedPos.toFixed(2) + ' drift=' + drift.toFixed(2) + 's');
  }

  function handlePeerTrack(d) {
    if (!d || !d.track) return;
    var track = d.track;
    state.peerTrack = { id: track.id, name: track.name, artist: track.artist, cover: track.cover, source: track.source };
    applyPeerQueue(d.queue, d.curIdx, track.id);
    if (typeof d.pos === 'number' && isFinite(d.pos) && d.pos > 0) {
      var audio = getAudioEl();
      if (audio) setRemote(function () { try { audio.currentTime = Math.max(0, d.pos); } catch (_) {} });
    }
    if (state.role === 'host') emit('peer:track', track);
  }

  function applyPeerQueue(peerQueue, peerCurIdx, targetTrackId) {
    if (!Array.isArray(peerQueue) || peerQueue.length === 0) return;
    setRemote(function () {
      try { window.playQueue = peerQueue.slice(); } catch (_) {}
      var idx = -1;
      if (typeof peerCurIdx === 'number' && peerCurIdx >= 0 && peerCurIdx < peerQueue.length) idx = peerCurIdx;
      if (idx < 0 && targetTrackId) {
        for (var i = 0; i < peerQueue.length; i++) if (String(peerQueue[i].id) === String(targetTrackId)) { idx = i; break; }
      }
      if (idx >= 0) {
        try { window.currentIdx = idx; } catch (_) {}
        if (typeof window.playQueueAt === 'function') window.playQueueAt(idx);
      }
    });
  }

  function handlePeerQueue(d) {
    if (!d || !Array.isArray(d.queue)) return;
    if (state.role === 'host') return;
    setRemote(function () { try { window.playQueue = d.queue.slice(); } catch (_) {} if (typeof d.curIdx === 'number' && d.curIdx >= 0) { try { window.currentIdx = d.curIdx; } catch (_) {} } });
  }

  function handlePeerPlay(action, d) {
    var audio = getAudioEl(); if (!audio) return;
    setRemote(function () {
      if (d && typeof d.pos === 'number' && isFinite(d.pos)) {
        try { audio.currentTime = Math.max(0, d.pos); } catch (_) {}
      }
      if (action === 'play' && audio.paused && typeof window.togglePlay === 'function') window.togglePlay();
      else if (action === 'pause' && !audio.paused && typeof window.togglePlay === 'function') window.togglePlay();
    });
  }
  function handlePeerSeek(d) { var audio = getAudioEl(); if (!audio || !d || typeof d.pos !== 'number') return; setRemote(function () { try { audio.currentTime = Math.max(0, d.pos); } catch (_) {} }); }

  // ==================================================================
  //  Playback hook
  // ==================================================================
  function hookPlayback() {
    if (window.__jiafeeCoPlay2Hooked) return;
    window.__jiafeeCoPlay2Hooked = true;

    if (typeof window.togglePlay === 'function' && !window.togglePlay.__coplay2) {
      var origToggle = window.togglePlay;
      window.togglePlay = function () {
        var wasRemote = state.isRemote;
        var audioBefore = getAudioEl();
        var wasPausedBefore = !!(audioBefore && audioBefore.paused);
        if (state.role === 'guest' && !wasRemote && wasPausedBefore && state.connected && state.peerPlaying) sendClockRequest();
        var result = origToggle.apply(this, arguments);
        if (!wasRemote && state.connected) {
          var audio = getAudioEl();
          if (audio) {
            var op = audio.paused ? 'PAUSE' : 'PLAY';
            var pos = isFinite(audio.currentTime) ? audio.currentTime : 0;
            sendDC({ t: op, d: { pos: pos, atMs: perfNow(), peerId: state.localPeerId } });
          }
        }
        return result;
      };
      window.togglePlay.__coplay2 = true;
    }

    if (typeof window.nextTrack === 'function' && !window.nextTrack.__coplay2) {
      var origNext = window.nextTrack;
      window.nextTrack = function (userInitiated) {
        if (state.isRemote) return origNext.apply(this, arguments);
        var result = origNext.apply(this, arguments);
        if (state.connected && userInitiated) {
          var audio = getAudioEl();
          sendDC({ t: 'SEEK', d: { pos: audio && isFinite(audio.currentTime) ? audio.currentTime : 0, atMs: perfNow() } });
        }
        return result;
      };
      window.nextTrack.__coplay2 = true;
    }

    if (typeof window.prevTrack === 'function' && !window.prevTrack.__coplay2) {
      var origPrev = window.prevTrack;
      window.prevTrack = function (userInitiated) {
        if (state.isRemote) return origPrev.apply(this, arguments);
        var result = origPrev.apply(this, arguments);
        if (state.connected && userInitiated) {
          var audio = getAudioEl();
          sendDC({ t: 'SEEK', d: { pos: audio && isFinite(audio.currentTime) ? audio.currentTime : 0, atMs: perfNow() } });
        }
        return result;
      };
      window.prevTrack.__coplay2 = true;
    }

    if (typeof window.playSearchResult === 'function' && !window.playSearchResult.__coplay2) {
      var origSearch = window.playSearchResult;
      window.playSearchResult = function (i) {
        if (state.isRemote) return origSearch.apply(this, arguments);
        var result = origSearch.apply(this, arguments);
        if (state.connected && state.role === 'guest') {
          setTimeout(function () { sendTrackSnapshot(); }, 300);
        }
        return result;
      };
      window.playSearchResult.__coplay2 = true;
    }

    if (typeof window.playQueueAt === 'function' && !window.playQueueAt.__coplay2) {
      var origPQA = window.playQueueAt;
      window.playQueueAt = function (idx, opts) {
        if (state.isRemote) return origPQA.apply(this, arguments);
        var result = origPQA.apply(this, arguments);
        if (state.connected && state.role === 'guest') {
          setTimeout(function () { sendTrackSnapshot(); }, 300);
        }
        return result;
      };
      window.playQueueAt.__coplay2 = true;
    }

    var audio = getAudioEl();
    if (audio && !audio.__coplay2) {
      audio.__coplay2 = true;
      audio.addEventListener('seeked', function () {
        if (state.connected && !state.isRemote) {
          var pos = isFinite(audio.currentTime) ? audio.currentTime : 0;
          sendDC({ t: 'SEEK', d: { pos: pos, atMs: perfNow(), peerId: state.localPeerId } });
        }
      });
    }
  }

  function setRemote(fn) { state.isRemote = true; try { fn(); } catch (_) {} state.isRemote = false; }

  // ==================================================================
  //  Reconnect / session lifecycle
  // ==================================================================
  function scheduleDcReconnect() {
    if (dcReconnectTimer) return;
    if (!state.code || !state.role) return;
    var delay = Math.min(CONFIG.dcReconnectBaseMs * Math.pow(2, state.reconnectAttempt), CONFIG.dcReconnectMaxMs);
    state.reconnectAttempt++;
    dcReconnectTimer = setTimeout(function () {
      dcReconnectTimer = null;
      if (state.connected) return;
      try { if (pc) pc.close(); } catch (_) {}
      pc = null; dc = null;
      // Rebuild the peer connection. Host will re-offer only after the guest
      // is present again; guest will re-use its code and reopen signaling.
      startWebRTC();
    }, delay);
  }

  function getLocalName() { try { return localStorage.getItem('mineradio.coplay2.name') || '好友'; } catch(_) { return '好友'; } }
  function setLocalName(name) { try { localStorage.setItem('mineradio.coplay2.name', String(name || '').trim() || '好友'); } catch(_) {} }

  function createRoom(name) {
    return new Promise(function (resolve, reject) {
      if (state.role) { reject(new Error('已在房间中，请先离开')); return; }
      var sigUrl = resolveSigUrl();
      state.role = 'host';
      state.sigUrl = sigUrl;
      var displayName = String(name || getLocalName()).slice(0, 20);
      setLocalName(displayName);
      var unsub = on('room:created', function (msg) { unsub(); emit('status', { role: 'host', code: msg.code, sigUrl: sigUrl }); resolve({ code: msg.code, sigUrl: sigUrl }); refreshLanSession(); });
      var unsubErr = on('sig:error', function (msg) { if (msg.code === 'ROOM_FULL' || msg.code === 'NO_CODE') { unsub(); unsubErr(); state.role = null; reject(new Error(msg.msg || '创建房间失败')); } });
      sigClient.connect(sigUrl);
      var waitForOpen = function () {
        var wsOpen = false;
        var unsubOpen = on('sig:open', function () { wsOpen = true; unsubOpen(); sigClient.send({ event: 'createRoom', name: displayName }); });
        setTimeout(function () { if (!wsOpen) { unsubOpen(); reject(new Error('信号服务器连接超时')); } }, 5000);
      };
      waitForOpen();
    });
  }

  function joinRoom(code, sigUrl) {
    return new Promise(function (resolve, reject) {
      if (state.role) { reject(new Error('已在房间中，请先离开')); return; }
      code = String(code || '').toUpperCase().trim();
      if (!code || code.length !== 4) { reject(new Error('邀请码格式错误（4位大写字母数字）')); return; }
      sigUrl = sigUrl || resolveSigUrl();
      state.role = 'guest';
      state.sigUrl = sigUrl;
      state.code = code;
      var displayName = String(getLocalName()).slice(0, 20);
      setLocalName(displayName);
      var unsub = on('room:joined', function (msg) { unsub(); emit('status', { role: 'guest', code: code }); resolve(); refreshLanSession(); });
      var unsubErr = on('sig:error', function (msg) { if (msg.code === 'NOT_FOUND' || msg.code === 'FULL' || msg.code === 'NO_HOST' || msg.code === 'BAD_CODE') { unsub(); unsubErr(); state.role = null; reject(new Error(msg.msg || '加入房间失败')); } });
      // sigClient.connect auto-sends joinRoom on open (and auto-rejoins on
      // reconnect) because state.code + state.role are already set here.
      sigClient.connect(sigUrl);
      setTimeout(function () {
        // fail fast if signaling never opens
        var opened = false;
        var unsubOpen = on('sig:open', function () { opened = true; unsubOpen(); });
        setTimeout(function () { unsubOpen(); if (!opened) { unsub(); unsubErr(); state.role = null; reject(new Error('信号服务器连接超时')); } }, 10000);
      }, 50);
    });
  }

  function connectDirect(target) {
    return new Promise(function (resolve, reject) {
      var normalized = normalizeTargetInput(target);
      if (!normalized) { reject(new Error('请输入有效的 IP、域名或 ws/wss 地址')); return; }
      state.directTarget = normalized;
      state.directMode = true;
      state.lastError = '';

      // The invite code is always fetched from the remote self endpoint when
      // possible; this avoids stale LAN-cache invite codes.
      traceHop('direct:fetch-code', { target: normalized });
      fetchRemoteSelf(normalized).then(function (self) {
        if (self && self.inviteCode) state.code = String(self.inviteCode).toUpperCase().trim();
        else if (!state.code) state.code = '';
        if (!state.code) { reject(new Error('对方未开放或缺少邀请码')); return; }

        state.role = 'guest';
        state.sigUrl = normalized;
        var resolved = false;
        var offJoined = on('room:joined', function () {
          resolved = true;
          offJoined(); offError(); offClose();
          resolve({ ok: true, target: normalized, code: state.code });
          refreshLanSession();
        });
        var offError = on('sig:error', function (msg) {
          if (resolved) return;
          offJoined(); offError(); offClose();
          state.role = null;
          reject(new Error((msg && msg.msg) || '直连失败'));
        });
        var offClose = on('sig:close', function () {
          if (resolved) return;
          // Ignore transient close during initial connect; timeout handles final failure.
        });
        sigClient.connect(normalized);
        setTimeout(function () {
          if (resolved) return;
          offJoined(); offError(); offClose();
          state.role = null;
          reject(new Error('直连超时'));
        }, 12000);
      }).catch(function (err) {
        state.role = null;
        reject(err);
      });
    });
  }

  function fetchRemoteSelf(target) {
    var m = String(target || '').match(/^(wss?):\/\/([^/]+)/);
    if (!m) return Promise.resolve(null);
    var proto = m[1] === 'wss' ? 'https' : 'http';
    var httpUrl = proto + '://' + m[2] + CONFIG.lanPath + '/self';
    traceHop('lan:fetchRemoteSelf', { url: httpUrl });
    return fetch(httpUrl, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function resolveLanDiscoveryUrl() {
    try {
      if (typeof window !== 'undefined' && window.location && /^https?:$/.test(window.location.protocol)) {
        return new URL(CONFIG.lanDiscoveryUrl, window.location.origin).href;
      }
    } catch (_) {}
    return CONFIG.lanDiscoveryUrl;
  }

  function normalizeTargetInput(input) {
    var raw = String(input || '').trim();
    if (!raw) return '';
    var invite = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^[A-Z0-9]{4}$/.test(invite)) {
      state.code = invite;
      return resolveSigUrl();
    }
    if (/^https?:\/\//i.test(raw) || /^wss?:\/\//i.test(raw)) {
      if (/\/coplay2\/ws(?:\?.*)?$/i.test(raw)) return raw;
      return raw.replace(/\/+$/, '') + CONFIG.sigPath;
    }
    if (/^[\w.-]+(?::\d+)?(?:\/.*)?$/.test(raw)) {
      if (/^[\w.-]+:\d+$/.test(raw)) return 'ws://' + raw + CONFIG.sigPath;
      if (/^[\w.-]+:\d+\/.*$/.test(raw)) return 'ws://' + raw.replace(/^\/?/, '') + (raw.indexOf('/coplay2/ws') >= 0 ? '' : CONFIG.sigPath);
      return 'ws://' + raw.replace(/\/+$/, '') + CONFIG.sigPath;
    }
    return '';
  }

  function leave() {
    if (state.role === 'host') sigClient.send({ event: 'leave', reason: 'host_leave' });
    else { sendDC({ t: 'BYE', d: { reason: 'guest_leave' } }); sigClient.send({ event: 'leave', reason: 'guest_leave' }); }
    cleanupSession('user_leave');
  }

  function cleanupSession(reason) {
    stopHostSync();
    if (clockSyncTimer) { clearInterval(clockSyncTimer); clockSyncTimer = null; }
    if (dcReconnectTimer) { clearTimeout(dcReconnectTimer); dcReconnectTimer = null; }
    if (state.pendingGuestStateTimer) { clearTimeout(state.pendingGuestStateTimer); state.pendingGuestStateTimer = null; }
    clearHostOfferTimer();
    clearLocalSnapshotTimer();
    state.pendingGuestState = null;
    state.pendingRemoteCandidates = [];
    clockSamples = [];
    clockOutstanding.forEach(function (timer) { try { clearTimeout(timer); } catch (_) {} });
    clockOutstanding.clear();
    try { if (dc) dc.close(); } catch (_) {}
    try { if (pc) pc.close(); } catch (_) {}
    dc = null; pc = null;
    state.role = null; state.code = null; state.connected = false; state.peer = null; state.peerTrack = null; state.clockOffset = 0; state.clockRtt = 0; state.reconnectAttempt = 0; state.isRemote = false; state.sessionId = 0; state.lastCorrectionAt = 0; state.lastAppliedTrackId = ''; state.directMode = false; state.directTarget = ''; state.userPaused = false; state.hostRetained = false;
    emit('status', { connected: false, role: null, reason: reason });
    refreshLanSession();
  }

  function resolveSigUrl() {
    if (state.sigUrl && /^(wss?:)?\/\//.test(state.sigUrl)) return state.sigUrl;
    try { var stored = localStorage.getItem('mineradio.coplay2.sigUrl'); if (stored) return stored; } catch (_) {}
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + CONFIG.sigPath;
  }

  function sendEmote(kind) { if (!state.connected) return; sendDC({ t: 'EMOTE', d: { kind: String(kind || 'like').slice(0, 20) } }); }
  function refreshLanSession() {
    if (!state.lanSelf) return;
    state.lanSelf.name = getLocalName();
    state.lanSelf.inviteCode = state.code || state.lanSelf.inviteCode || '';
    state.lanSelf.mode = state.role || 'idle';
    state.lanSelf.connected = !!state.connected;
    state.lanSelf.peerName = state.peer && state.peer.name ? state.peer.name : '';
    state.lanSelf.updatedAt = now();
    emit('lan:update', { self: state.lanSelf, peers: state.lanDevices.slice() });
  }

  function setLanDevices(list, self) {
    state.lanDevices = Array.isArray(list) ? list.slice() : [];
    state.lanSelf = self || state.lanSelf;
    refreshLanSession();
  }

  function refreshLanDevices() {
    var url = resolveLanDiscoveryUrl();
    traceHop('lan:refresh-request', { url: url });
    return fetch(url, { cache: 'no-store' })
      .then(function (r) {
        traceHop('lan:refresh-response', { ok: r.ok, status: r.status, url: url });
        if (!r.ok) return r.text().then(function (t) { throw new Error('LAN 列表请求失败 HTTP ' + r.status + (t ? ' ' + t.slice(0, 120) : '')); });
        return r.json();
      })
      .then(function (data) {
        traceHop('lan:refresh-success', { peers: (data.peers || []).length, self: !!data.self });
        setLanDevices(data.peers || [], data.self || null);
        return data;
      })
      .catch(function (err) {
        console.warn('[CoPlay2][LAN] refresh failed:', err && err.message ? err.message : err);
        state.lastError = err && err.message ? err.message : 'LAN 列表请求失败';
        emit('lan:error', { msg: state.lastError });
        return { self: state.lanSelf, peers: state.lanDevices.slice() };
      });
  }

  function connectLanPeer(peer) {
    var target = peer && (peer.wsUrl || peer.httpUrl || (peer.ip ? ('ws://' + peer.ip + ':' + (peer.port || 3000) + CONFIG.sigPath) : ''));
    if (!target) return Promise.reject(new Error('设备信息无效'));
    traceHop('lan:connect-peer', { target: target, inviteCode: peer && peer.inviteCode ? peer.inviteCode : '' });
    // Always prefer the remote /self advertised code over the cached LAN
    // record, because LAN entries can be slightly stale during reconnects.
    state.code = '';
    return connectDirect(target || '');
  }

  // ==================================================================
  //  Public status
  // ==================================================================
  function getStatus() {
    return {
      role: state.role,
      code: state.code,
      sigUrl: state.sigUrl,
      connected: state.connected,
      peer: state.peer,
      peerTrack: state.peerTrack,
      peerPlaying: state.peerPlaying,
      clockOffset: state.clockOffset,
      clockRtt: state.clockRtt,
      rtt: state.rtt,
      version: 3,
      lanSelf: state.lanSelf,
      lanDevices: state.lanDevices.slice(),
      directMode: state.directMode,
      directTarget: state.directTarget,
      lastError: state.lastError,
      localPeerId: state.localPeerId,
      hostRetained: state.hostRetained,
    };
  }

  function init() {
    function tryHook() {
      if (typeof window.togglePlay === 'function' && typeof window.audio !== 'undefined') { hookPlayback(); return true; }
      return false;
    }
    if (!tryHook()) {
      var retries = 0;
      var retryTimer = setInterval(function () { retries++; if (tryHook() || retries > 50) clearInterval(retryTimer); }, 200);
    }
    refreshLanDevices();
    setInterval(function () { if (!state.role && !state.connected) refreshLanDevices(); }, 4500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  var api = {
    createRoom: createRoom,
    joinRoom: joinRoom,
    connectDirect: connectDirect,
    connectLanPeer: connectLanPeer,
    refreshLanDevices: refreshLanDevices,
    leave: leave,
    sendEmote: sendEmote,
    setLocalName: setLocalName,
    on: on,
    getStatus: getStatus,
    config: CONFIG,
    _sigClient: sigClient,
    _state: state,
    _sendDC: sendDC,
    get _pc() { return pc; },
    get _dc() { return dc; },
  };

  window.jiafeeCoPlayV2 = api;
  if (!window.jiafeeCoPlay) {
    window.jiafeeCoPlay = {
      getPeerNow: function () { return state.peerTrack || { name: '', artist: '', cover: '' }; },
      getStatus: function () { return state.connected ? 'connected' : 'idle'; },
    };
  }
  console.log('[CoPlay2] runtime initialized');
})();
