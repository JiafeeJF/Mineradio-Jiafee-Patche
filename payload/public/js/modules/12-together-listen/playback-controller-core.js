'use strict';

(function exposePlaybackControllerCore(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioTogetherPlaybackCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPlaybackControllerCore() {
  var STATUSES = new Set(['idle', 'loading', 'playing', 'paused', 'switching', 'seeking', 'error', 'ready', 'waiting', 'buffering']);

  function initialState() {
    return { status: 'idle', trackId: '', position: 0, version: -1, lastOperationId: '' };
  }

  function PlaybackStateMachine(onChange) {
    this.state = initialState();
    this.onChange = typeof onChange === 'function' ? onChange : function () {};
  }

  PlaybackStateMachine.prototype.transition = function (patch, source) {
    var next = Object.assign({}, this.state, patch || {});
    if (!STATUSES.has(next.status)) throw new Error('INVALID_PLAYBACK_STATUS');
    if (Number(next.version) < Number(this.state.version)) return this.state;
    next.trackId = String(next.trackId || '');
    next.position = Math.max(0, Number(next.position) || 0);
    next.version = Number(next.version);
    next.lastOperationId = String(next.lastOperationId || '');
    this.state = Object.freeze(next);
    this.onChange(this.state, source || 'system');
    return this.state;
  };

  PlaybackStateMachine.prototype.reset = function () {
    this.state = Object.freeze(initialState());
    this.onChange(this.state, 'system');
  };

  function PlaybackController(options) {
    options = options || {};
    if (!options.adapter || typeof options.send !== 'function') throw new Error('PLAYBACK_CONTROLLER_DEPENDENCIES_REQUIRED');
    this.adapter = options.adapter;
    this.send = options.send;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.clientId = '';
    this.connected = false;
    this.connectionEpoch = 0;
    this.acceptedVersion = -1;
    this.processedOperations = new Set();
    this.pendingPredictions = new Map();
    this.readyTransitions = new Set();
    this.execution = Promise.resolve();
    this.executing = false;
    this.activeExecution = null;
    this.lastCorrectionAt = 0;
    this.sessionStarted = false;
    this.appliedSessionKey = '';
    this.endedTrackId = '';
    this.onError = typeof options.onError === 'function' ? options.onError : function () {};
    this.createOperationId = typeof options.createOperationId === 'function' ? options.createOperationId : function () {
      return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
    };
    this.machine = new PlaybackStateMachine(options.onState);
  }

  PlaybackController.prototype.setConnection = function (connected, clientId) {
    var nextConnected = !!connected;
    var changed = nextConnected !== this.connected;
    this.connected = nextConnected;
    this.clientId = String(clientId || this.clientId || '');
    if (!changed) return;
    this.connectionEpoch += 1;
    if (!this.connected) {
      if (typeof this.adapter.cancelPendingWait === 'function') this.adapter.cancelPendingWait();
      this.acceptedVersion = -1;
      this.processedOperations.clear();
      this.pendingPredictions.clear();
      this.readyTransitions.clear();
      this.execution = Promise.resolve();
      this.executing = false;
      this.activeExecution = null;
      this.sessionStarted = false;
      this.endedTrackId = '';
      if (typeof this.adapter.resetPlaybackRate === 'function') this.adapter.resetPlaybackRate();
      this.machine.reset();
    }
  };

  PlaybackController.prototype.rememberOperation = function (operationId) {
    var key = String(operationId || '');
    if (!key) return true;
    if (this.processedOperations.has(key)) return false;
    this.processedOperations.add(key);
    while (this.processedOperations.size > 2048) this.processedOperations.delete(this.processedOperations.values().next().value);
    return true;
  };

  PlaybackController.prototype.request = function (action, payload, source) {
    if (!this.connected) return Promise.resolve(null);
    source = source || 'local';
    if (source !== 'local') return Promise.resolve(null);
    return Promise.resolve(this.send(String(action || '').toUpperCase(), payload || {}, 'local'));
  };

  PlaybackController.prototype.dispatchLocal = function (action, payload) {
    if (!this.connected) return Promise.resolve(null);
    action = String(action || '').toUpperCase();
    payload = payload || {};
    var operationId = String(this.createOperationId() || '');
    if (!operationId) return Promise.reject(new Error('OPERATION_ID_REQUIRED'));
    var prediction = { operationId: operationId, action: action, payload: payload, createdAt: this.now(), epoch: this.connectionEpoch };
    this.pendingPredictions.set(operationId, prediction);
    if (['NEXT', 'PREVIOUS'].includes(action) && typeof this.adapter.cancelPendingWait === 'function') this.adapter.cancelPendingWait();
    var self = this;
    this.execution = this.execution.then(function () {
      return self.applyPrediction(prediction);
    }).catch(function (error) {
      self.pendingPredictions.delete(operationId);
      self.onError(error);
      return { error: error };
    });
    var sent;
    try {
      sent = Promise.resolve(this.send(action, payload, 'local', operationId));
    } catch (error) {
      this.pendingPredictions.delete(operationId);
      this.onError(error);
      return Promise.reject(error);
    }
    return sent.catch(function (error) {
      self.pendingPredictions.delete(operationId);
      self.onError(error);
      throw error;
    });
  };

  PlaybackController.prototype.applyPrediction = async function (prediction) {
    if (!this.connected || prediction.epoch !== this.connectionEpoch) return { ignored: true, reason: 'stale-session' };
    var action = prediction.action;
    var operationId = prediction.operationId;
    var actual = this.adapter.readState();
    var version = Math.max(-1, Number(this.machine.state.version));
    var token = { epoch: prediction.epoch, operationId: operationId };
    this.activeExecution = token;
    this.executing = true;
    try {
      if (typeof this.adapter.resetPlaybackRate === 'function' && ['PAUSE', 'SEEK', 'NEXT', 'PREVIOUS'].includes(action)) this.adapter.resetPlaybackRate();
      if (action === 'PLAY') {
        if (!actual.playing) await this.adapter.play();
        if (!this.isCurrentSession(prediction.epoch)) return { ignored: true, reason: 'stale-session-after-play' };
        actual = this.adapter.readState();
        this.machine.transition({ status: actual.playing ? 'playing' : 'buffering', trackId: actual.trackId, position: actual.position, version: version, lastOperationId: operationId }, 'local-predicted');
      } else if (action === 'PAUSE') {
        if (actual.playing) await this.adapter.pause();
        if (!this.isCurrentSession(prediction.epoch)) return { ignored: true, reason: 'stale-session-after-pause' };
        actual = this.adapter.readState();
        this.machine.transition({ status: 'paused', trackId: actual.trackId, position: actual.position, version: version, lastOperationId: operationId }, 'local-predicted');
      } else if (action === 'SEEK') {
        var position = Math.max(0, Number(prediction.payload.position) || 0);
        this.machine.transition({ status: 'seeking', trackId: actual.trackId, position: position, version: version, lastOperationId: operationId }, 'local-predicted');
        await this.adapter.seek(position);
        if (!this.isCurrentSession(prediction.epoch)) return { ignored: true, reason: 'stale-session-after-seek' };
        actual = this.adapter.readState();
        this.machine.transition({ status: actual.playing ? 'playing' : 'paused', trackId: actual.trackId, position: actual.position, version: version, lastOperationId: operationId }, 'local-predicted');
      } else if (action === 'NEXT' || action === 'PREVIOUS') {
        if (actual.playing) await this.adapter.pause();
        if (!this.isCurrentSession(prediction.epoch)) return { ignored: true, reason: 'stale-session-after-switch-request' };
        actual = this.adapter.readState();
        this.machine.transition({ status: 'switching', trackId: actual.trackId, position: actual.position, version: version, lastOperationId: operationId }, 'local-predicted');
      }
      return { predicted: true, operationId: operationId };
    } finally {
      if (this.activeExecution === token) {
        this.activeExecution = null;
        this.executing = false;
      }
    }
  };

  PlaybackController.prototype.isCurrentSession = function (epoch) {
    return this.connected && Number(epoch) === this.connectionEpoch;
  };

  PlaybackController.prototype.isCurrentAuthority = function (epoch, version) {
    return this.isCurrentSession(epoch) && Number(version) === this.acceptedVersion;
  };

  PlaybackController.prototype.rejectPrediction = function (operationId) {
    return this.pendingPredictions.delete(String(operationId || ''));
  };

  PlaybackController.prototype.resetSessionIdentity = function () {
    this.appliedSessionKey = '';
    this.sessionStarted = false;
  };

  PlaybackController.prototype.feedback = function (action, payload) {
    if (!this.connected) return Promise.resolve(null);
    return Promise.resolve(this.send(String(action || '').toUpperCase(), payload || {}, 'system'));
  };

  PlaybackController.prototype.acceptAuthority = function (event) {
    var authority = event && event.state;
    if (!this.connected || !authority) return Promise.resolve({ ignored: true, reason: 'disconnected' });
    var version = Number(authority.version) || 0;
    var operationId = event.progressSnapshot === true ? '' : String(event.operationId || authority.lastOperationId || '');
    if (operationId) this.pendingPredictions.delete(operationId);
    if (version < this.acceptedVersion) return Promise.resolve({ ignored: true, reason: 'stale-version' });
    if (operationId && !this.rememberOperation(operationId)) return Promise.resolve({ ignored: true, reason: 'duplicate-operation' });

    if (event.progressSnapshot === true || (event.metadataOnly === true && version === this.acceptedVersion)) {
      this.correctProgress(authority);
      return Promise.resolve({ progress: true });
    }

    if (version > this.acceptedVersion && typeof this.adapter.cancelPendingWait === 'function') this.adapter.cancelPendingWait();
    if (version > this.acceptedVersion) this.acceptedVersion = version;
    var self = this;
    var epoch = this.connectionEpoch;
    this.execution = this.execution.then(function () {
      if (!self.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'superseded-before-execution' };
      return self.applyAuthority(authority, event, epoch);
    }).catch(function (error) {
      if (!self.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'stale-error' };
      self.machine.transition({ status: 'error', version: Math.max(version, self.machine.state.version), lastOperationId: operationId }, 'system');
      self.onError(error);
      return { error: error };
    });
    return this.execution;
  };

  PlaybackController.prototype.sourceFor = function (event) {
    return event && event.acceptedSenderId && event.acceptedSenderId === this.clientId ? 'local' : 'remote';
  };

  PlaybackController.prototype.applyAuthority = async function (authority, event, epoch) {
    var version = Number(authority.version) || 0;
    var operationId = String(event.operationId || authority.lastOperationId || '');
    var source = this.sourceFor(event);
    var transition = authority.transition || null;
    var targetTrackId = String(authority.currentTrackId || '');
    var token = { epoch: epoch, version: version, operationId: operationId };
    this.activeExecution = token;
    this.executing = true;
    try {
      if (!this.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'stale-session' };
      if (typeof this.adapter.resetPlaybackRate === 'function' && (!authority.playing || (transition && transition.phase !== 'go'))) this.adapter.resetPlaybackRate();
      var sessionKey = String(authority.serverId || '') + ':' + String(Math.max(0, Number(authority.sessionEpoch) || 0));
      if (sessionKey !== ':0' && sessionKey !== this.appliedSessionKey) {
        if (typeof this.adapter.resetSessionPlayback === 'function') await this.adapter.resetSessionPlayback(authority);
        if (!this.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'superseded-during-session-reset' };
        this.appliedSessionKey = sessionKey;
        this.sessionStarted = false;
      }
      if (Array.isArray(authority.queue) && authority.queue.length) this.sessionStarted = true;
      if (this.sessionStarted) this.adapter.syncQueue(authority);
      if (authority.mode) this.adapter.setMode(authority.mode);
      var actual = this.adapter.readState();
      var trackChanged = !!targetTrackId && actual.trackId !== targetTrackId;
      if (trackChanged) {
        this.endedTrackId = '';
        this.machine.transition({ status: 'switching', trackId: targetTrackId, position: 0, version: version, lastOperationId: operationId }, source);
        var switched = await this.adapter.switchTrack(authority, version);
        if (!this.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'superseded-during-switch' };
        if (switched !== true) throw new Error('PLAYBACK_TRACK_UNAVAILABLE');
      }

      if (transition && transition.phase === 'awaiting-end') {
        this.machine.transition({ status: 'waiting', trackId: targetTrackId, position: Number(authority.position) || 0, version: version, lastOperationId: operationId }, source);
        return { waiting: true };
      }

      if (transition && transition.phase === 'preparing') {
        this.machine.transition({ status: 'loading', trackId: targetTrackId, position: 0, version: version, lastOperationId: operationId }, source);
        var ready = await this.adapter.waitUntilReady(targetTrackId, function () { return version === this.acceptedVersion; }.bind(this));
        if (!this.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'superseded-during-load' };
        if (!ready) throw new Error('PLAYBACK_TRACK_NOT_READY');
        this.machine.transition({ status: 'ready', trackId: targetTrackId, position: 0, version: version, lastOperationId: operationId }, 'system');
        if (!this.readyTransitions.has(transition.id)) {
          this.readyTransitions.add(transition.id);
          await this.feedback('READY', { phase: 'loaded', transitionId: transition.id, targetTrackId: targetTrackId });
          if (!this.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'superseded-after-ready' };
        }
        return { ready: true };
      }

      if (String(authority.lastAction || event.action || '') === 'SEEK') {
        this.machine.transition({ status: 'seeking', trackId: targetTrackId, position: Number(authority.position) || 0, version: version, lastOperationId: operationId }, source);
        await this.adapter.seek(Number(authority.position) || 0);
        if (!this.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'superseded-after-seek' };
      } else if (trackChanged) {
        await this.adapter.seek(this.authoritativePosition(authority));
        if (!this.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'superseded-after-track-seek' };
      }

      actual = this.adapter.readState();
      if (authority.playing) {
        this.endedTrackId = '';
        if (!actual.playing) await this.adapter.play();
      } else if (actual.playing) {
        await this.adapter.pause();
      }
      if (!this.isCurrentAuthority(epoch, version)) return { ignored: true, reason: 'superseded-after-play-state' };
      actual = this.adapter.readState();
      this.machine.transition({
        status: !targetTrackId ? 'idle' : (authority.playing ? (actual.playing ? 'playing' : 'buffering') : 'paused'),
        trackId: targetTrackId,
        position: Number(actual.position) || Number(authority.position) || 0,
        version: version,
        lastOperationId: operationId,
      }, source);
      this.correctProgress(authority);
      return { applied: true };
    } finally {
      if (this.activeExecution === token) {
        this.activeExecution = null;
        this.executing = false;
      }
    }
  };

  PlaybackController.prototype.authoritativePosition = function (authority) {
    var position = Math.max(0, Number(authority.position) || 0);
    if (!authority.playing) return position;
    var serverNow = this.now() + (Number(authority.clockOffsetMs) || 0);
    var serverTimestamp = Number(authority.serverTimestamp) || serverNow;
    return position + Math.max(0, serverNow - serverTimestamp) / 1000;
  };

  PlaybackController.prototype.correctProgress = function (authority) {
    if (this.executing || !authority || !authority.currentTrackId) return false;
    if (['loading', 'switching', 'seeking', 'ready', 'waiting', 'buffering'].includes(this.machine.state.status)) return false;
    var actual = this.adapter.readState();
    if (actual.trackId !== String(authority.currentTrackId)) return false;
    var expected = this.authoritativePosition(authority);
    var drift = (Number(actual.position) || 0) - expected;
    var absoluteDrift = Math.abs(drift);
    if (absoluteDrift < 0.3) {
      if (typeof this.adapter.resetPlaybackRate === 'function') this.adapter.resetPlaybackRate();
      return false;
    }
    if (absoluteDrift <= 1 && authority.playing && actual.playing && typeof this.adapter.setPlaybackRate === 'function') {
      this.adapter.setPlaybackRate(drift < 0 ? 1.02 : 0.98);
      return true;
    }
    if (typeof this.adapter.resetPlaybackRate === 'function') this.adapter.resetPlaybackRate();
    var now = this.now();
    if (now - this.lastCorrectionAt < 1500) return false;
    this.lastCorrectionAt = now;
    Promise.resolve(this.adapter.seek(expected)).catch(this.onError);
    return true;
  };

  PlaybackController.prototype.reportEnded = function () {
    if (!this.connected || !this.machine.state.trackId) return Promise.resolve(null);
    if (this.endedTrackId === this.machine.state.trackId) return Promise.resolve(null);
    this.endedTrackId = this.machine.state.trackId;
    this.machine.transition({ status: 'waiting' }, 'system');
    return this.feedback('READY', { phase: 'ended', targetTrackId: this.machine.state.trackId });
  };

  PlaybackController.prototype.whenIdle = function () { return this.execution; };

  return { PlaybackStateMachine: PlaybackStateMachine, PlaybackController: PlaybackController, STATUSES: STATUSES };
});
