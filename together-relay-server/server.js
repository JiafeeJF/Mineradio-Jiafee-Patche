'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadRoomService() {
  const candidates = [
    path.join(__dirname, 'lib', 'room-service.js'),
    path.join(__dirname, '..', 'payload', 'desktop', 'together-listen', 'room-service.js'),
  ];
  const modulePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!modulePath) throw new Error('ROOM_SERVICE_NOT_FOUND');
  return require(modulePath).RoomService;
}

function integerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function booleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

const RoomService = loadRoomService();
const port = integerEnv('PORT', 17861, 1, 65535);
const host = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
const name = String(process.env.ROOM_NAME || 'Mineradio 一起听中转').trim().slice(0, 64) || 'Mineradio 一起听中转';
const authorizationCode = String(process.env.AUTHORIZATION_CODE || '').trim();
const allowLanWithoutAuthorization = booleanEnv('ALLOW_LAN_WITHOUT_AUTH', false);
const debug = booleanEnv('DEBUG', false);
// Display-only public endpoint; the socket continues to bind HOST:PORT.
const publicAddress = String(process.env.PUBLIC_ADDRESS || '').trim();
if (publicAddress) {
  const match = publicAddress.match(/^(\[[0-9a-f:]+\]|[a-z0-9.-]+):(\d{1,5})$/i);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) {
    console.error('[relay] PUBLIC_ADDRESS must be a domain:port or IP:port without a URL scheme.');
    process.exit(1);
  }
}

if (!/^\d{6}$/.test(authorizationCode)) {
  console.error('[relay] AUTHORIZATION_CODE must contain exactly 6 digits.');
  process.exit(1);
}

const service = new RoomService({
  serverId: String(process.env.SERVER_ID || `relay-${crypto.randomBytes(12).toString('hex')}`).slice(0, 96),
  name,
  authorizationCode,
  port,
  host,
  allowLanWithoutAuthorization,
  onTrace: debug ? (entry) => console.info('[relay:trace]', JSON.stringify(entry)) : null,
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[relay] received ${signal}, closing connections...`);
  const forceExit = setTimeout(() => process.exit(1), 8000);
  forceExit.unref();
  try {
    await service.stop('SERVER_CLOSED');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error('[relay] shutdown failed:', error && error.stack || error);
    process.exit(1);
  }
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('[relay] uncaught exception:', error && error.stack || error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (error) => {
  console.error('[relay] unhandled rejection:', error && error.stack || error);
  shutdown('unhandledRejection');
});

service.start().then((address) => {
  console.info(`[relay] ${name}`);
  console.info(`[relay] listening on ${address.host}:${address.port}/tcp`);
  console.info(`[relay] join address: ${publicAddress || `<server-domain-or-ip>:${address.port}`} (native TCP; no ws:// or wss:// prefix needed)`);
  console.info(`[relay] authorization: required${allowLanWithoutAuthorization ? ' (LAN bypass enabled)' : ''}`);
  console.info('[relay] capacity: 2 clients; persistence: disabled; audio transport: disabled');
}).catch((error) => {
  console.error('[relay] startup failed:', error && error.stack || error);
  process.exit(1);
});
