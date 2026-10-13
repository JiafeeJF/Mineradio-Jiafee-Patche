'use strict';

(function installTogetherListenPlayerAdapter() {
  if (window.MineradioTogetherPlayerAdapter) return;

  var player = {
    togglePlay: togglePlay,
    nextTrack: nextTrack,
    prevTrack: prevTrack,
    playQueueAt: playQueueAt,
    queueSong: queueSong,
    removeFromQueue: removeFromQueue,
    cyclePlayMode: cyclePlayMode,
    commitProgressSeek: commitProgressSeek
  };
  var cancelPendingReadyWait = null;
  var preparedTrackId = '';

  function trackId(song) {
    return song ? String(song.__togetherTrackId || queueItemKey(song) || '') : '';
  }

  function audioTrackId() {
    if (!audio || !audio.src) return '';
    if (audio.__mineradioQueueItemKey) return String(audio.__mineradioQueueItemKey);
    return trackId(currentCoverSong());
  }

  function serializeTrack(song) {
    if (!song) return null;
    var provider = String(song.provider || song.source || song.type || '').toLowerCase();
    var providerId = song.spotifyId || song.mid || song.songmid || song.hash || song.id || '';
    return {
      trackId: trackId(song), provider: provider, providerId: String(providerId || ''),
      id: song.id == null ? '' : String(song.id), mid: String(song.mid || song.songmid || ''),
      spotifyId: String(song.spotifyId || ''), hash: String(song.hash || song.fileHash || song.audioHash || ''),
      name: String(song.name || song.title || ''), artist: String(song.artist || ''), album: String(song.album || ''),
      duration: playbackDurationFromSong(song), cover: String(song.cover || '')
    };
  }

  function materializeTrack(remote, existingById) {
    if (existingById[remote.trackId]) return existingById[remote.trackId];
    var song = {
      provider: remote.provider, source: remote.provider, id: remote.id || remote.providerId,
      mid: remote.mid || (remote.provider === 'qq' ? remote.providerId : ''),
      spotifyId: remote.spotifyId || (remote.provider === 'spotify' ? remote.providerId : ''),
      hash: remote.hash || (remote.provider === 'kugou' ? remote.providerId : ''),
      name: remote.name, artist: remote.artist, album: remote.album, duration: remote.duration, cover: remote.cover
    };
    song.__togetherTrackId = remote.trackId;
    return song;
  }

  function snapshot() {
    return {
      queue: playQueue.slice(0, 200).map(serializeTrack).filter(Boolean),
      currentIndex: currentIdx,
      position: getPlaybackCurrentSeconds(),
      playing: !!(audio && !audio.paused && !audio.ended),
      mode: playMode
    };
  }

  function readState() {
    return {
      status: !audio || !audio.src ? 'idle' : (audio.seeking ? 'seeking' : (audio.readyState < 3 ? 'loading' : (audio.paused || audio.ended ? 'paused' : 'playing'))),
      trackId: audioTrackId(),
      position: getPlaybackCurrentSeconds(),
      playing: !!(audio && !audio.paused && !audio.ended),
      currentIndex: currentIdx,
      mode: playMode,
      playbackRate: audio ? Number(audio.playbackRate) || 1 : 1
    };
  }

  function syncQueue(authority) {
    var remoteQueue = Array.isArray(authority.queue) ? authority.queue : [];
    var localKeys = playQueue.map(trackId).join('\n');
    var remoteKeys = remoteQueue.map(function (item) { return item.trackId; }).join('\n');
    if (localKeys === remoteKeys) return false;
    var loadedTrackId = audioTrackId();
    var existingById = {};
    playQueue.forEach(function (song) { existingById[trackId(song)] = song; });
    playQueue = remoteQueue.map(function (remote) { return materializeTrack(remote, existingById); });
    var loadedIndex = playQueue.findIndex(function (song) { return trackId(song) === loadedTrackId; });
    currentIdx = loadedIndex >= 0 ? loadedIndex : Math.max(-1, Math.min(playQueue.length - 1, currentIdx));
    safeRenderQueuePanel('together-authoritative-queue', { scrollCurrent: miniQueueOpen, deferWhenHidden: false });
    safeShelfRebuild('together-authoritative-queue', true);
    return true;
  }

  async function switchTrack(authority, version) {
    var targetIndex = Math.max(-1, Math.min(playQueue.length - 1, Number(authority.currentIndex)));
    if (targetIndex < 0 || !playQueue[targetIndex] || trackId(playQueue[targetIndex]) !== String(authority.currentTrackId || '')) return false;
    currentIdx = targetIndex;
    var started = await player.playQueueAt(targetIndex, {
      manual: false,
      skipShuffleOrder: true,
      preserveHomeState: true,
      suppressPlayFailureNotice: true,
      resumeAt: Math.max(0, Number(authority.position) || 0),
      startPaused: true,
      togetherStateVersion: version
    });
    var matchesTarget = started === true && audioTrackId() === String(authority.currentTrackId || '');
    if (matchesTarget && audio) {
      preparedTrackId = String(authority.currentTrackId || '');
      audio.autoplay = false;
      if (!audio.paused) audio.pause();
      playing = false;
      setPlayIcon(false);
    }
    if (!matchesTarget) preparedTrackId = '';
    return matchesTarget;
  }

  function waitUntilReady(targetTrackId, isCurrent) {
    var media = audio;
    if (!media || !media.src || audioTrackId() !== String(targetTrackId || '')) return Promise.resolve(false);
    if (Number(media.readyState) >= 3) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var settled = false;
      function cleanup() {
        media.removeEventListener('canplay', onReady);
        media.removeEventListener('canplaythrough', onReady);
        media.removeEventListener('error', onFailure);
        media.removeEventListener('abort', onFailure);
      }
      function finish(value) {
        if (settled) return;
        settled = true;
        if (cancelPendingReadyWait === cancel) cancelPendingReadyWait = null;
        cleanup();
        resolve(!!value && (!isCurrent || isCurrent()) && audio === media && audioTrackId() === String(targetTrackId || ''));
      }
      function onReady() { finish(Number(media.readyState) >= 3); }
      function onFailure() { finish(false); }
      function cancel() { finish(false); }
      if (cancelPendingReadyWait) cancelPendingReadyWait();
      cancelPendingReadyWait = cancel;
      media.addEventListener('canplay', onReady);
      media.addEventListener('canplaythrough', onReady);
      media.addEventListener('error', onFailure);
      media.addEventListener('abort', onFailure);
    });
  }

  function cancelPendingWait() {
    if (cancelPendingReadyWait) cancelPendingReadyWait();
    cancelPendingReadyWait = null;
  }

  function clearPlaybackDisplay() {
    if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(null);
    if (typeof setControlCoverSrc === 'function') setControlCoverSrc('');
    if (typeof document === 'undefined') return;
    var title = document.getElementById('thumb-title');
    var artist = document.getElementById('thumb-artist');
    var cover = document.getElementById('thumb-cover');
    var wrap = document.getElementById('thumb-wrap');
    if (title) title.textContent = '';
    if (artist) artist.textContent = '';
    if (cover) cover.removeAttribute('src');
    if (wrap) wrap.classList.remove('visible');
  }

  async function resetSessionPlayback() {
    cancelPendingWait();
    preparedTrackId = '';
    trackSwitchToken += 1;
    if (typeof clearAudioFadeTimers === 'function') clearAudioFadeTimers();
    if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
    if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('together-session-reset', { keepCurrentAudio: false });
    if (audio) {
      try {
        audio.onended = null;
        audio.pause();
        if (typeof audio.removeAttribute === 'function') audio.removeAttribute('src');
        else audio.src = '';
        audio.__mineradioQueueItemKey = '';
        audio.__mineradioTrackSwitchToken = 0;
        if (typeof audio.load === 'function') audio.load();
      } catch (_) { }
    }
    playing = false;
    playQueue = [];
    currentIdx = -1;
    if (typeof currentLocalSong !== 'undefined') currentLocalSong = null;
    clearPlaybackDisplay();
    setPlayIcon(false);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (typeof updatePlaybackProgressUi === 'function') updatePlaybackProgressUi();
    safeRenderQueuePanel('together-session-reset', { scrollCurrent: false, deferWhenHidden: false });
    safeShelfRebuild('together-session-reset', true);
    return true;
  }

  async function playExplicit() {
    if (!audio || !audio.src) return false;
    if (!audio.paused && !audio.ended) return true;
    var prepared = !!preparedTrackId && preparedTrackId === audioTrackId();
    var started = await attemptAudioPlay({
      manual: false,
      silent: true,
      trackSwitch: prepared,
      expectedMedia: audio,
      expectedToken: audio.__mineradioTrackSwitchToken == null ? trackSwitchToken : audio.__mineradioTrackSwitchToken
    }) === true;
    if (started && prepared) preparedTrackId = '';
    return started;
  }

  async function pauseExplicit() {
    if (!audio || audio.paused || audio.ended) return true;
    if (typeof clearAudioFadeTimers === 'function') clearAudioFadeTimers();
    if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
    audio.pause();
    playing = false;
    setPlayIcon(false);
    hideLoading();
    forcePlaybackControlsInteractive();
    return !!audio.paused;
  }

  async function seekExplicit(position) {
    if (!audio || !audio.src) return false;
    var duration = Number(audio.duration) || getPlaybackDurationSeconds() || Number.MAX_SAFE_INTEGER;
    var target = Math.max(0, Math.min(duration, Number(position) || 0));
    if (Math.abs((Number(audio.currentTime) || 0) - target) < 0.05) return true;
    audio.currentTime = target;
    if (typeof updatePlaybackProgressUi === 'function') updatePlaybackProgressUi();
    if (typeof syncBeatMapPlaybackCursor === 'function') syncBeatMapPlaybackCursor(target, true);
    return true;
  }

  function setPlaybackRate(rate) {
    if (!audio || !audio.src) return false;
    var normalized = Math.max(0.98, Math.min(1.02, Number(rate) || 1));
    if (Math.abs((Number(audio.playbackRate) || 1) - normalized) < 0.001) return true;
    audio.playbackRate = normalized;
    return true;
  }

  function resetPlaybackRate() {
    if (!audio || Math.abs((Number(audio.playbackRate) || 1) - 1) < 0.001) return false;
    audio.playbackRate = 1;
    return true;
  }

  function setMode(mode) {
    if (!['loop', 'shuffle', 'single'].includes(mode) || playMode === mode) return false;
    playMode = mode;
    if (typeof updatePlayModeButton === 'function') updatePlayModeButton();
    if (typeof syncActiveAudioRepeatMode === 'function' && audio) syncActiveAudioRepeatMode(audio);
    return true;
  }

  window.MineradioTogetherPlayerAdapter = Object.freeze({
    originals: player,
    trackId: trackId,
    serializeTrack: serializeTrack,
    snapshot: snapshot,
    readState: readState,
    syncQueue: syncQueue,
    switchTrack: switchTrack,
    waitUntilReady: waitUntilReady,
    cancelPendingWait: cancelPendingWait,
    resetSessionPlayback: resetSessionPlayback,
    play: playExplicit,
    pause: pauseExplicit,
    seek: seekExplicit,
    setPlaybackRate: setPlaybackRate,
    resetPlaybackRate: resetPlaybackRate,
    setMode: setMode
  });
})();
