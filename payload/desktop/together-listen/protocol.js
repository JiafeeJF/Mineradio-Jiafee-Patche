'use strict';

const crypto = require('crypto');

const TYPES = Object.freeze({
  HELLO: 'HELLO',
  JOIN_ROOM: 'JOIN_ROOM',
  ROOM_STATE: 'ROOM_STATE',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  SEEK: 'SEEK',
  NEXT: 'NEXT',
  PREVIOUS: 'PREVIOUS',
  QUEUE_ADD: 'QUEUE_ADD',
  QUEUE_REMOVE: 'QUEUE_REMOVE',
  SET_MODE: 'SET_MODE',
  READY: 'READY',
  GO: 'GO',
  PRESENCE: 'PRESENCE',
  MESSAGE_SEND: 'MESSAGE_SEND',
  HEARTBEAT: 'HEARTBEAT',
  RESYNC: 'RESYNC',
  LEAVE_ROOM: 'LEAVE_ROOM',
  ERROR: 'ERROR',
});

const CONTROL_TYPES = new Set([
  TYPES.PLAY, TYPES.PAUSE, TYPES.SEEK, TYPES.NEXT, TYPES.PREVIOUS,
  TYPES.QUEUE_ADD, TYPES.QUEUE_REMOVE, TYPES.SET_MODE, TYPES.RESYNC,
  TYPES.READY,
  TYPES.PRESENCE, TYPES.MESSAGE_SEND,
]);

function id(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function boundedText(value, max = 160) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function sanitizeTrack(value) {
  if (!value || typeof value !== 'object') return null;
  const provider = boundedText(value.provider || value.source || value.type, 24).toLowerCase();
  const providerId = boundedText(value.providerId || value.spotifyId || value.mid || value.songmid || value.hash || value.id, 160);
  const trackId = boundedText(value.trackId, 220) || (provider && providerId ? `${provider}:${providerId}` : '');
  if (!trackId || !boundedText(value.name || value.title, 240)) return null;
  return {
    trackId,
    provider,
    providerId,
    name: boundedText(value.name || value.title, 240),
    artist: boundedText(value.artist, 240),
    album: boundedText(value.album, 240),
    duration: Math.max(0, Math.min(86400, Number(value.duration) || 0)),
    cover: /^https?:\/\//i.test(String(value.cover || '')) ? boundedText(value.cover, 2048) : '',
    id: boundedText(value.id, 160),
    mid: boundedText(value.mid || value.songmid, 160),
    spotifyId: boundedText(value.spotifyId, 160),
    hash: boundedText(value.hash, 160),
  };
}

function validateEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'INVALID_MESSAGE' };
  const type = boundedText(value.action || value.type, 32).toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(TYPES, type)) return { ok: false, error: 'UNKNOWN_TYPE' };
  const envelope = {
    id: boundedText(value.id, 128),
    type,
    action: type,
    serverId: boundedText(value.serverId, 96),
    senderId: boundedText(value.senderId, 96),
    operationId: boundedText(value.operationId, 128),
    timestamp: Math.max(0, Math.floor(Number(value.timestamp) || 0)),
    source: ['local', 'remote', 'system'].includes(value.source) ? value.source : 'local',
    stateVersion: Math.max(0, Math.floor(Number(value.version != null ? value.version : value.stateVersion) || 0)),
    payload: value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload) ? value.payload : {},
  };
  envelope.version = envelope.stateVersion;
  if (!envelope.senderId) return { ok: false, error: 'MISSING_SENDER' };
  if (CONTROL_TYPES.has(type)) {
    if (!envelope.operationId) return { ok: false, error: 'MISSING_OPERATION_ID' };
    if (!envelope.id) return { ok: false, error: 'MISSING_MESSAGE_ID' };
    if (!boundedText(value.action, 32)) return { ok: false, error: 'MISSING_ACTION' };
    if (!Number.isFinite(Number(value.timestamp)) || Number(value.timestamp) <= 0) return { ok: false, error: 'INVALID_TIMESTAMP' };
    if (value.version == null || !Number.isFinite(Number(value.version))) return { ok: false, error: 'INVALID_VERSION' };
    if (!['local', 'system'].includes(value.source)) return { ok: false, error: 'INVALID_SOURCE' };
  }
  return { ok: true, value: envelope };
}

module.exports = { TYPES, CONTROL_TYPES, id, boundedText, sanitizeTrack, validateEnvelope };
