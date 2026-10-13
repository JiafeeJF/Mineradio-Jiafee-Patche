'use strict';

const dgram = require('dgram');

const MAGIC = 'MINERADIO_TOGETHER_V1';
const DISCOVERY_PORT = 17862;

class LanDiscovery {
  constructor({ getAdvertisement }) {
    this.getAdvertisement = getAdvertisement;
    this.socket = null;
  }

  async start() {
    if (this.socket) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (buffer, remote) => {
      let message;
      try { message = JSON.parse(buffer.toString('utf8')); } catch (_) { return; }
      if (!message || message.magic !== MAGIC) return;
      if (message.kind === 'QUERY') {
        const ad = this.getAdvertisement();
        if (!ad) return;
        const payload = Buffer.from(JSON.stringify({ magic: MAGIC, kind: 'ROOM', ...ad }));
        socket.send(payload, remote.port, remote.address);
      }
    });
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
        socket.removeListener('error', reject);
        socket.setBroadcast(true);
        resolve();
      });
    });
    this.socket = socket;
  }

  discover(timeoutMs = 1300) {
    return new Promise(async (resolve) => {
      try { await this.start(); } catch (_) { resolve([]); return; }
      const rooms = new Map();
      const onMessage = (buffer, remote) => {
        let message;
        try { message = JSON.parse(buffer.toString('utf8')); } catch (_) { return; }
        if (!message || message.magic !== MAGIC || message.kind !== 'ROOM') return;
        const port = Number(message.port);
        if (!message.serverId || !Number.isInteger(port) || port < 1 || port > 65535) return;
        const address = `${remote.address}:${port}`;
        rooms.set(`${message.serverId}@${address}`, {
          serverId: String(message.serverId).slice(0, 96), name: String(message.name || '一起听服务器').slice(0, 64),
          address, host: remote.address, port, members: Math.max(0, Math.min(2, Number(message.members) || 0)),
          status: 'online', latencyMs: Math.max(0, Date.now() - Number(message.sentAt || Date.now())),
        });
      };
      this.socket.on('message', onMessage);
      const query = Buffer.from(JSON.stringify({ magic: MAGIC, kind: 'QUERY' }));
      this.socket.send(query, DISCOVERY_PORT, '255.255.255.255');
      setTimeout(() => {
        if (this.socket) this.socket.removeListener('message', onMessage);
        resolve([...rooms.values()]);
      }, Math.max(300, Math.min(4000, Number(timeoutMs) || 1300)));
    });
  }

  close() { if (this.socket) { try { this.socket.close(); } catch (_) { } this.socket = null; } }
}

module.exports = { LanDiscovery, DISCOVERY_PORT };
