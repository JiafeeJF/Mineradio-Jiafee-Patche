'use strict';

const crypto = require('crypto');

const DEFAULT_CONFIG = Object.freeze({
  roomName: 'Mineradio 一起听中转',
  host: '0.0.0.0',
  port: 17861,
  publicAddress: '',
  allowLanWithoutAuth: false,
  debug: false,
  autoStartApp: false,
  autoStartService: false,
  restartOnCrash: true,
  startMinimized: false,
  serverId: '',
});

function generateAuthorizationCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function normalizeConfig(input = {}) {
  const raw = { ...DEFAULT_CONFIG, ...input };
  return {
    roomName: String(raw.roomName || '').trim(),
    host: String(raw.host || '').trim(),
    port: Number(raw.port),
    publicAddress: String(raw.publicAddress || '').trim(),
    allowLanWithoutAuth: !!raw.allowLanWithoutAuth,
    debug: !!raw.debug,
    autoStartApp: !!raw.autoStartApp,
    autoStartService: !!raw.autoStartService,
    restartOnCrash: raw.restartOnCrash !== false,
    startMinimized: !!raw.startMinimized,
    serverId: String(raw.serverId || '').trim() || `relay-${crypto.randomBytes(12).toString('hex')}`,
  };
}

function validateConfig(input = {}, authorizationCode = '') {
  const config = normalizeConfig(input);
  const errors = {};
  if (!config.roomName || config.roomName.length > 64) errors.roomName = '房间名称需为 1–64 个字符。';
  if (!config.host || config.host.length > 255 || /\s/.test(config.host)) errors.host = '监听地址无效。';
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) errors.port = '端口需为 1–65535 的整数。';
  if (config.publicAddress) {
    const match = config.publicAddress.match(/^(\[[0-9a-f:]+\]|[a-z0-9.-]+):(\d{1,5})$/i);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) errors.publicAddress = '请输入域名:端口或 IP:端口，不要添加协议前缀。';
  }
  if (!/^\d{6}$/.test(String(authorizationCode || ''))) errors.authorizationCode = '授权码必须是 6 位数字。';
  return { ok: !Object.keys(errors).length, errors, config };
}

function publicConfig(config, authorizationCodeConfigured) {
  return { ...normalizeConfig(config), authorizationCodeConfigured: !!authorizationCodeConfigured };
}

module.exports = { DEFAULT_CONFIG, generateAuthorizationCode, normalizeConfig, validateConfig, publicConfig };

