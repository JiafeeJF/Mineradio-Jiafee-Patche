'use strict';

(function installTogetherListenPlaybackController() {
  if (!window.togetherListen || !window.MineradioTogetherPlaybackCore || !window.MineradioTogetherPlayerAdapter) return;
  if (window.MineradioTogetherPlaybackController) return;

  var bridge = window.togetherListen;
  var adapter = window.MineradioTogetherPlayerAdapter;
  var originals = adapter.originals;
  var latestRoom = null;
  var lastPresenceStatus = '';
  var clearPlaybackOnNextConnection = true;
  var togetherSessionActive = false;

  function showError(error) {
    var message = error && error.message === 'PLAYBACK_TRACK_UNAVAILABLE'
      ? '一起听：本机无法加载这首歌，请检查平台权限或音源'
      : '一起听播放控制失败：' + String(error && error.message || error);
    if (typeof showToast === 'function') showToast(message);
    document.dispatchEvent(new CustomEvent('mineradio-together-error', { detail: { code: String(error && error.message || error) } }));
  }

  function createOperationId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var bytes = new Uint8Array(18);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
  }

  function send(action, payload, source, operationId) {
    return bridge.sendOperation(action, payload || {}, source || 'local', operationId || '');
  }

  var controller = new window.MineradioTogetherPlaybackCore.PlaybackController({
    adapter: adapter,
    send: send,
    createOperationId: createOperationId,
    onError: showError,
    onState: function (state) {
      var status = state.status === 'ready' ? 'ready' : state.status;
      if (controller.connected && status !== lastPresenceStatus) {
        lastPresenceStatus = status;
        send('PRESENCE', { status: status }, 'system').catch(function () { lastPresenceStatus = ''; });
      }
      document.dispatchEvent(new CustomEvent('mineradio-together-playback-state', { detail: state }));
    }
  });

  function setConnectionFromStatus(status) {
    var connected = !!(status && status.connectionState === 'connected');
    var wasTogetherSessionActive = togetherSessionActive;
    controller.setConnection(connected, status && status.clientId);
    if (connected && clearPlaybackOnNextConnection) {
      clearPlaybackOnNextConnection = false;
      Promise.resolve(adapter.resetSessionPlayback()).catch(showError);
    }
    if (connected) togetherSessionActive = true;
    if (!connected) {
      if (status && status.connectionState === 'idle') {
        clearPlaybackOnNextConnection = true;
        togetherSessionActive = false;
        if (typeof controller.resetSessionIdentity === 'function') controller.resetSessionIdentity();
        if (wasTogetherSessionActive) Promise.resolve(adapter.resetSessionPlayback()).catch(showError);
      }
      latestRoom = null;
      lastPresenceStatus = '';
    }
    document.body.classList.toggle('together-connected', connected);
    document.dispatchEvent(new CustomEvent('mineradio-together-status', { detail: status || {} }));
  }

  function acceptRoomEvent(event) {
    latestRoom = event.state;
    controller.acceptAuthority(event);
    document.dispatchEvent(new CustomEvent('mineradio-together-state', { detail: event.state }));
  }

  function seedSharedPlayback() {
    var snapshot = adapter.snapshot();
    if (!snapshot.queue.length || snapshot.currentIndex < 0) return Promise.resolve(false);
    snapshot.playing = false;
    snapshot.position = Math.max(0, Number(snapshot.position) || 0);
    return controller.request('RESYNC', { snapshot: snapshot }, 'local').then(function () { return true; });
  }

  function ensureTrackShared(song, index) {
    var key = adapter.trackId(song);
    var known = latestRoom && Array.isArray(latestRoom.queue) && latestRoom.queue.some(function (item) { return item.trackId === key; });
    if (known) return Promise.resolve(key);
    return controller.request('QUEUE_ADD', { track: adapter.serializeTrack(song), index: Math.max(0, Number(index) || 0) }, 'local').then(function () { return key; });
  }

  bridge.onEvent(function (event) {
    if (event.kind === 'status') setConnectionFromStatus(event.status);
    if (event.kind === 'room-state') acceptRoomEvent(event);
    if (event.kind === 'message') document.dispatchEvent(new CustomEvent('mineradio-together-message', { detail: event }));
    if (event.kind === 'error') {
      if (event.operationId && controller.rejectPrediction(event.operationId)) controller.feedback('RESYNC', { reason: 'prediction-rejected' }).catch(function () {});
      document.dispatchEvent(new CustomEvent('mineradio-together-error', { detail: event }));
    }
  });

  togglePlay = function () {
    if (!controller.connected) return originals.togglePlay.apply(this, arguments);
    var actual = adapter.readState();
    if (!latestRoom || !latestRoom.currentTrackId) {
      var targetAction = actual.playing ? 'PAUSE' : 'PLAY';
      return seedSharedPlayback().then(function (seeded) {
        if (!seeded) return null;
        var seededState = adapter.readState();
        return controller.dispatchLocal(targetAction, { position: seededState.position, trackId: seededState.trackId });
      });
    }
    return controller.dispatchLocal(actual.playing ? 'PAUSE' : 'PLAY', { position: actual.position, trackId: actual.trackId });
  };

  nextTrack = function (userInitiated) {
    if (!controller.connected) return originals.nextTrack.apply(this, arguments);
    if (userInitiated !== true) return controller.reportEnded();
    if (!latestRoom || !latestRoom.currentTrackId) {
      return seedSharedPlayback().then(function (seeded) {
        if (!seeded) return null;
        return controller.dispatchLocal('NEXT', { playing: true });
      });
    }
    return controller.dispatchLocal('NEXT', { playing: true });
  };

  prevTrack = function (userInitiated) {
    if (!controller.connected) return originals.prevTrack.apply(this, arguments);
    if (userInitiated !== true) return controller.reportEnded();
    if (!latestRoom || !latestRoom.currentTrackId) {
      return seedSharedPlayback().then(function (seeded) {
        if (!seeded) return null;
        return controller.dispatchLocal('PREVIOUS', { playing: true });
      });
    }
    return controller.dispatchLocal('PREVIOUS', { playing: true });
  };

  playQueueAt = function (index) {
    if (!controller.connected) return originals.playQueueAt.apply(this, arguments);
    var options = arguments[1] || {};
    if (options.autoRepeat) return controller.reportEnded();
    var song = playQueue[index];
    if (!song) return Promise.resolve(false);
    if (!latestRoom || !latestRoom.currentTrackId) {
      var initialTargetTrackId = adapter.trackId(song);
      return seedSharedPlayback().then(function (seeded) {
        if (!seeded) return false;
        return controller.dispatchLocal('NEXT', { targetTrackId: initialTargetTrackId, playing: true });
      });
    }
    return ensureTrackShared(song, index).then(function (targetTrackId) {
      return controller.dispatchLocal('NEXT', { targetTrackId: targetTrackId, playing: true });
    });
  };

  queueSong = function (song, options) {
    if (!controller.connected) return originals.queueSong.apply(this, arguments);
    var index = options && options.position === 'next' ? Math.max(0, currentIdx + 1) : playQueue.length;
    return controller.request('QUEUE_ADD', { track: adapter.serializeTrack(song), index: index }, 'local');
  };

  removeFromQueue = function (index) {
    if (!controller.connected) return originals.removeFromQueue.apply(this, arguments);
    var song = playQueue[index];
    return controller.request('QUEUE_REMOVE', { index: index, trackId: adapter.trackId(song) }, 'local');
  };

  cyclePlayMode = function () {
    if (!controller.connected) return originals.cyclePlayMode.apply(this, arguments);
    var modes = ['loop', 'shuffle', 'single'];
    return controller.request('SET_MODE', { mode: modes[(modes.indexOf(playMode) + 1) % modes.length] }, 'local');
  };

  commitProgressSeek = function (targetTime) {
    if (!controller.connected) return originals.commitProgressSeek.apply(this, arguments);
    return controller.dispatchLocal('SEEK', { position: Math.max(0, Number(targetTime) || 0), trackId: adapter.readState().trackId });
  };

  bridge.getStatus().then(function (status) {
    setConnectionFromStatus(status);
    if (status && status.room) acceptRoomEvent({ state: status.room, operationId: status.room.lastOperationId || '', acceptedSenderId: '' });
  }).catch(function () {});

  controller.isConnected = function () { return controller.connected; };
  controller.getRoom = function () { return latestRoom; };
  controller.destroy = function () { controller.setConnection(false); };
  window.MineradioTogetherPlaybackController = controller;
})();
