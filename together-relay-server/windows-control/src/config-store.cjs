'use strict';

const fs = require('fs');
const path = require('path');
const { generateAuthorizationCode, normalizeConfig, validateConfig, publicConfig } = require('./validation.cjs');

class ConfigStore {
  constructor({ directory, safeStorage }) {
    this.directory = directory;
    this.safeStorage = safeStorage;
    this.configPath = path.join(directory, 'relay-control.json');
    this.secretPath = path.join(directory, 'relay-secret.bin');
    this.config = normalizeConfig();
    this.authorizationCode = '';
  }

  load() {
    fs.mkdirSync(this.directory, { recursive: true });
    if (fs.existsSync(this.configPath)) {
      try { this.config = normalizeConfig(JSON.parse(fs.readFileSync(this.configPath, 'utf8'))); } catch (_) { this.config = normalizeConfig(); }
    }
    this.authorizationCode = this.readSecret();
    if (!/^\d{6}$/.test(this.authorizationCode)) {
      this.authorizationCode = generateAuthorizationCode();
      this.writeSecret(this.authorizationCode);
    }
    this.persistConfig();
    return this.getPublic();
  }

  readSecret() {
    if (!fs.existsSync(this.secretPath) || !this.safeStorage.isEncryptionAvailable()) return '';
    try { return this.safeStorage.decryptString(fs.readFileSync(this.secretPath)); } catch (_) { return ''; }
  }

  writeSecret(value) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密暂不可用，请重新登录系统后再试。');
    fs.writeFileSync(this.secretPath, this.safeStorage.encryptString(value), { mode: 0o600 });
  }

  persistConfig() {
    const temporary = `${this.configPath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.configPath);
  }

  update(next, newAuthorizationCode = '') {
    const authorizationCode = newAuthorizationCode || this.authorizationCode;
    const checked = validateConfig(next, authorizationCode);
    if (!checked.ok) return checked;
    if (newAuthorizationCode) this.writeSecret(newAuthorizationCode);
    this.authorizationCode = authorizationCode;
    this.config = checked.config;
    this.persistConfig();
    return { ok: true, config: this.getPublic() };
  }

  getPublic() { return publicConfig(this.config, /^\d{6}$/.test(this.authorizationCode)); }
  revealAuthorizationCode() { return this.authorizationCode; }
  getRuntime() { return { ...this.config, authorizationCode: this.authorizationCode }; }
}

module.exports = { ConfigStore };

