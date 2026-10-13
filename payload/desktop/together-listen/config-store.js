'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_AVATARS = new Set(['default:signal', 'default:rose', 'default:mono', 'default:mint']);

function sanitizeAvatar(value) {
  const avatar = String(value || 'default:signal');
  if (DEFAULT_AVATARS.has(avatar)) return avatar;
  if (avatar.length <= 24000 && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(avatar)) return avatar;
  return 'default:signal';
}

function sanitizeProfile(value = {}) {
  return {
    name: String(value.name || value.displayName || 'Mineradio 听众').trim().slice(0, 48) || 'Mineradio 听众',
    avatar: sanitizeAvatar(value.avatar),
  };
}

class TogetherConfigStore {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, 'together-listen.json');
    this.data = this.read();
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const profile = sanitizeProfile(parsed.profile || { displayName: parsed.displayName, avatar: parsed.avatar });
      return { version: 2, clientId: String(parsed.clientId || crypto.randomUUID()), displayName: profile.name, profile, servers: Array.isArray(parsed.servers) ? parsed.servers.slice(0, 100) : [] };
    } catch (_) {
      const profile = sanitizeProfile();
      return { version: 2, clientId: crypto.randomUUID(), displayName: profile.name, profile, servers: [] };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    try {
      fs.renameSync(temp, this.file);
    } catch (error) {
      // Some Windows setups briefly lock the destination file. Keep the save usable
      // while retaining the temporary-file write for the normal atomic path.
      try {
        fs.copyFileSync(temp, this.file);
        fs.unlinkSync(temp);
      } catch (_) {
        try { fs.unlinkSync(temp); } catch (_) {}
        throw error;
      }
    }
  }

  list() { return JSON.parse(JSON.stringify(this.data.servers)); }

  profile() { return JSON.parse(JSON.stringify(this.data.profile)); }

  updateProfile(value) {
    this.data.profile = sanitizeProfile(value);
    this.data.displayName = this.data.profile.name;
    this.save();
    return this.profile();
  }

  upsert(value) {
    const id = String(value.id || crypto.randomUUID()).slice(0, 96);
    const entry = {
      id, name: String(value.name || '好友服务器').trim().slice(0, 64), address: String(value.address || '').trim().slice(0, 512),
      lastConnectedAt: Number(value.lastConnectedAt) || 0, lastStatus: String(value.lastStatus || 'unknown').slice(0, 24),
    };
    const index = this.data.servers.findIndex((item) => item.id === id);
    if (index >= 0) this.data.servers[index] = entry; else this.data.servers.unshift(entry);
    this.data.servers = this.data.servers.slice(0, 100);
    this.save();
    return entry;
  }

  remove(id) {
    const before = this.data.servers.length;
    this.data.servers = this.data.servers.filter((item) => item.id !== String(id));
    if (this.data.servers.length !== before) this.save();
    return this.data.servers.length !== before;
  }
}

module.exports = { TogetherConfigStore, sanitizeAvatar, sanitizeProfile };
