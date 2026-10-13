'use strict';

const { TYPES, sanitizeTrack } = require('./protocol');

class AuthoritativeRoom {
  constructor({ serverId, name }) {
    this.serverId = serverId;
    this.name = name;
    this.sequence = 0;
    this.seen = new Map();
    this.state = {
      serverId: this.serverId,
      name,
      sessionEpoch: 1,
      version: 0,
      sequence: 0,
      status: 'idle',
      playing: false,
      position: 0,
      serverTimestamp: Date.now(),
      currentTrackId: '',
      currentIndex: -1,
      queue: [],
      mode: 'loop',
      lastOperationId: '',
      lastAction: '',
      lastSenderId: '',
      members: [],
      transition: null,
      playAt: 0,
    };
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  resetForNewPair(operationId = '', senderId = 'server') {
    const state = this.state;
    this.advanceClock();
    this.clearTransition();
    state.sessionEpoch = Math.max(1, Number(state.sessionEpoch) || 1) + 1;
    state.status = 'idle';
    state.playing = false;
    state.position = 0;
    state.currentTrackId = '';
    state.currentIndex = -1;
    state.queue = [];
    state.lastOperationId = String(operationId || '');
    state.lastAction = 'SESSION_RESET';
    state.lastSenderId = String(senderId || 'server');
    state.version += 1;
    this.sequence += 1;
    state.sequence = this.sequence;
    state.serverTimestamp = Date.now();
    return this.snapshot();
  }

  advanceClock(now = Date.now()) {
    if (this.state.playing && this.state.serverTimestamp) {
      this.state.position = Math.max(0, this.state.position + Math.max(0, now - this.state.serverTimestamp) / 1000);
      if (now < this.state.serverTimestamp) return;
    }
    this.state.serverTimestamp = now;
  }

  setMembers(members) {
    this.advanceClock();
    this.state.members = members.slice(0, 2).map((member) => ({
      senderId: String(member.senderId || '').slice(0, 96),
      name: String(member.name || '听众').slice(0, 48),
      joinedAt: Number(member.joinedAt) || Date.now(),
      avatar: String(member.avatar || 'default:signal').slice(0, 24000),
      status: String(member.status || 'idle').slice(0, 24),
      latencyMs: Math.max(0, Math.min(9999, Math.round(Number(member.latencyMs) || 0))),
      expression: member.expression ? {
        text: String(member.expression.text || '').slice(0, 100),
        time: Number(member.expression.time) || 0,
        expiresAt: Number(member.expression.expiresAt) || 0,
      } : null,
    }));
    const transition = this.state.transition;
    if (!transition) return { go: false };
    if (transition.phase === 'awaiting-end' && this.allMembersReady(transition.endedSenderIds)) {
      this.beginPreparing(transition);
      this.state.version += 1;
      this.state.serverTimestamp = Date.now();
      return { go: false, changed: true };
    }
    if (transition.phase === 'preparing' && this.allMembersReady(transition.readySenderIds)) {
      this.beginGo(transition);
      this.state.version += 1;
      return { go: true, changed: true };
    }
    return { go: false };
  }

  allMembersReady(senderIds) {
    const required = this.state.members.map((member) => member.senderId).filter(Boolean);
    return required.length > 0 && required.every((senderId) => senderIds.includes(senderId));
  }

  clearTransition() {
    this.state.transition = null;
    this.state.playAt = 0;
  }

  nextAutomaticIndex() {
    const state = this.state;
    if (!state.queue.length) return -1;
    if (state.mode === 'single') return Math.max(0, state.currentIndex);
    return (Math.max(0, state.currentIndex) + 1) % state.queue.length;
  }

  beginPreparing(transition) {
    const state = this.state;
    const index = this.nextAutomaticIndex();
    if (index < 0) return false;
    transition.phase = 'preparing';
    transition.targetIndex = index;
    transition.targetTrackId = state.queue[index].trackId;
    transition.readySenderIds = [];
    transition.desiredPlaying = true;
    state.currentIndex = index;
    state.currentTrackId = transition.targetTrackId;
    state.position = 0;
    state.playing = false;
    state.status = 'switching';
    state.playAt = 0;
    return true;
  }

  beginGo(transition, now = Date.now()) {
    const state = this.state;
    const playAt = now;
    transition.phase = 'go';
    transition.goAt = playAt;
    state.position = 0;
    state.playing = true;
    state.status = 'playing';
    state.playAt = playAt;
    state.serverTimestamp = playAt;
  }

  hasSeen(operationId) {
    return this.seen.has(operationId);
  }

  apply(message) {
    if (this.hasSeen(message.operationId)) return { changed: false, duplicate: true, sequence: this.seen.get(message.operationId) };
    const payload = message.payload || {};
    const state = this.state;
    if (Number(message.stateVersion) > Number(state.version)) return { changed: false, error: 'FUTURE_STATE_VERSION' };
    this.advanceClock();
    let changed = true;
    let error = '';
    let go = false;

    if (message.type === TYPES.PLAY) {
      const hadTransition = !!state.transition;
      this.clearTransition();
      const matchingTrack = !payload.trackId || String(payload.trackId) === state.currentTrackId;
      const position = matchingTrack && Number.isFinite(Number(payload.position)) ? Math.max(0, Number(payload.position)) : state.position;
      changed = hadTransition || !state.playing || Math.abs(position - state.position) > 0.3;
      state.playing = true;
      state.status = state.currentTrackId ? 'playing' : 'idle';
      state.position = position;
    } else if (message.type === TYPES.PAUSE) {
      const hadTransition = !!state.transition;
      this.clearTransition();
      const matchingTrack = !payload.trackId || String(payload.trackId) === state.currentTrackId;
      const position = matchingTrack && Number.isFinite(Number(payload.position)) ? Math.max(0, Number(payload.position)) : state.position;
      changed = hadTransition || state.playing || Math.abs(position - state.position) > 0.3;
      state.playing = false;
      state.status = state.currentTrackId ? 'paused' : 'idle';
      state.position = position;
    } else if (message.type === TYPES.SEEK) {
      const position = Number(payload.position);
      if (payload.trackId && String(payload.trackId) !== state.currentTrackId) error = 'STALE_TRACK_OPERATION';
      else if (!Number.isFinite(position) || position < 0) error = 'INVALID_SEEK';
      else {
        this.clearTransition();
        state.position = Math.min(86400, position);
      }
    } else if (message.type === TYPES.NEXT || message.type === TYPES.PREVIOUS) {
      if (!state.queue.length) error = 'EMPTY_QUEUE';
      else {
        const fromTrackId = state.currentTrackId;
        this.clearTransition();
        let index = Number.isInteger(payload.targetIndex) ? payload.targetIndex : -1;
        if (payload.targetTrackId) index = state.queue.findIndex((track) => track.trackId === String(payload.targetTrackId));
        if (index < 0 || index >= state.queue.length) {
          const delta = message.type === TYPES.NEXT ? 1 : -1;
          index = (Math.max(0, state.currentIndex) + delta + state.queue.length) % state.queue.length;
        }
        state.currentIndex = index;
        state.currentTrackId = state.queue[index].trackId;
        state.position = 0;
        state.playing = false;
        state.status = 'switching';
        state.transition = {
          id: message.operationId,
          phase: 'preparing',
          kind: 'manual',
          fromTrackId,
          targetTrackId: state.currentTrackId,
          targetIndex: index,
          endedSenderIds: [],
          readySenderIds: [],
          desiredPlaying: payload.playing !== false,
          goAt: 0,
        };
      }
    } else if (message.type === TYPES.READY) {
      const phase = String(payload.phase || '');
      if (phase === 'ended') {
        if (!state.currentTrackId || String(payload.targetTrackId || '') !== state.currentTrackId) error = 'STALE_TRACK_READY';
        else {
          if (state.transition && state.transition.phase === 'go') this.clearTransition();
          if (state.transition && state.transition.phase !== 'awaiting-end') changed = false;
          if (changed) {
            if (!state.transition) {
              state.transition = {
                id: message.operationId,
                phase: 'awaiting-end',
                fromTrackId: state.currentTrackId,
                targetTrackId: '',
                targetIndex: -1,
                endedSenderIds: [],
                readySenderIds: [],
                goAt: 0,
              };
            }
            const transition = state.transition;
            if (!transition.endedSenderIds.includes(message.senderId)) transition.endedSenderIds.push(message.senderId);
            state.status = 'waiting';
            if (this.allMembersReady(transition.endedSenderIds)) this.beginPreparing(transition);
          }
        }
      } else if (phase === 'loaded') {
        const transition = state.transition;
        if (!transition || transition.phase !== 'preparing') changed = false;
        else if (String(payload.transitionId || '') !== transition.id || String(payload.targetTrackId || '') !== transition.targetTrackId) error = 'STALE_TRANSITION_READY';
        else {
          if (!transition.readySenderIds.includes(message.senderId)) transition.readySenderIds.push(message.senderId);
          if (this.allMembersReady(transition.readySenderIds)) {
            if (transition.desiredPlaying === false) {
              this.clearTransition();
              state.playing = false;
              state.status = state.currentTrackId ? 'paused' : 'idle';
            } else {
              this.beginGo(transition);
              go = true;
            }
          }
        }
      } else error = 'INVALID_READY_PHASE';
    } else if (message.type === TYPES.QUEUE_ADD) {
      const track = sanitizeTrack(payload.track);
      if (!track) error = 'INVALID_TRACK';
      else if (state.queue.length >= 200) error = 'QUEUE_LIMIT';
      else {
        const index = Math.max(0, Math.min(state.queue.length, Number.isInteger(payload.index) ? payload.index : state.queue.length));
        state.queue.splice(index, 0, track);
        if (state.currentIndex >= index) state.currentIndex += 1;
        if (!state.currentTrackId) {
          state.currentIndex = index;
          state.currentTrackId = track.trackId;
          state.status = 'paused';
        }
      }
    } else if (message.type === TYPES.QUEUE_REMOVE) {
      let index = Number.isInteger(payload.index) ? payload.index : -1;
      if (payload.trackId) index = state.queue.findIndex((track) => track.trackId === String(payload.trackId));
      if (index < 0 || index >= state.queue.length) error = 'TRACK_NOT_FOUND';
      else {
        const removedCurrent = index === state.currentIndex;
        state.queue.splice(index, 1);
        if (!state.queue.length) {
          this.clearTransition();
          state.currentIndex = -1;
          state.currentTrackId = '';
          state.position = 0;
          state.playing = false;
          state.status = 'idle';
        } else {
          if (index < state.currentIndex) state.currentIndex -= 1;
          if (removedCurrent) {
            this.clearTransition();
            state.currentIndex = Math.min(index, state.queue.length - 1);
            state.currentTrackId = state.queue[state.currentIndex].trackId;
            state.position = 0;
            state.status = state.playing ? 'playing' : 'paused';
          }
        }
      }
    } else if (message.type === TYPES.SET_MODE) {
      if (!['loop', 'shuffle', 'single'].includes(payload.mode)) error = 'INVALID_MODE';
      else state.mode = payload.mode;
    } else if (message.type === TYPES.RESYNC) {
      const incoming = payload.snapshot;
      if (state.queue.length || state.currentTrackId || !incoming || typeof incoming !== 'object') {
        changed = false;
      } else {
        state.queue = (Array.isArray(incoming.queue) ? incoming.queue : []).slice(0, 200).map(sanitizeTrack).filter(Boolean);
        let index = Math.max(-1, Math.min(state.queue.length - 1, Math.floor(Number(incoming.currentIndex))));
        if (index < 0 && state.queue.length) index = 0;
        state.currentIndex = index;
        state.currentTrackId = index >= 0 ? state.queue[index].trackId : '';
        state.position = Math.max(0, Math.min(86400, Number(incoming.position) || 0));
        state.playing = !!incoming.playing;
        state.mode = ['loop', 'shuffle', 'single'].includes(incoming.mode) ? incoming.mode : 'loop';
        state.status = state.currentTrackId ? (state.playing ? 'playing' : 'paused') : 'idle';
      }
    } else {
      changed = false;
    }

    if (error) return { changed: false, error };
    this.sequence += 1;
    this.seen.set(message.operationId, this.sequence);
    while (this.seen.size > 1000) this.seen.delete(this.seen.keys().next().value);
    if (changed) {
      state.version += 1;
      state.lastOperationId = message.operationId;
      state.lastAction = message.type;
      state.lastSenderId = message.senderId;
    }
    state.sequence = this.sequence;
    if (!go) state.serverTimestamp = Date.now();
    return { changed, sequence: this.sequence, go };
  }
}

module.exports = { AuthoritativeRoom };
