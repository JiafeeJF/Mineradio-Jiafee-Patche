'use strict';

const net = require('net');
const { EventEmitter } = require('events');

const PROTOCOL = 'MINERADIO/1';
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const DEFAULT_MAX_PAYLOAD = 64 * 1024;

class TcpFrameSocket extends EventEmitter {
  constructor(socket, options = {}) {
    super();
    this._socket = socket;
    this.readyState = options.open ? OPEN : 0;
    this.maxPayload = Number(options.maxPayload) || DEFAULT_MAX_PAYLOAD;
    this.buffer = Buffer.alloc(0);
    this.closeCode = 1006;
    this.closeReason = '';
    this.frameListener = null;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);
    socket.on('error', (error) => {
      if (this.listenerCount('error')) this.emit('error', error);
    });
    socket.on('close', () => {
      if (this.readyState === CLOSED) return;
      this.readyState = CLOSED;
      this.emit('close', this.closeCode, Buffer.from(this.closeReason));
    });
    if (options.open) this.activate(options.initialData);
  }

  activate(initialData) {
    if (this.frameListener) return;
    this.readyState = OPEN;
    this.frameListener = (chunk) => this.consume(chunk);
    this._socket.on('data', this.frameListener);
    if (initialData && initialData.length) process.nextTick(() => this.consume(initialData));
  }

  consume(chunk) {
    if (this.readyState !== OPEN || !chunk || !chunk.length) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (size < 1 || size > this.maxPayload) {
        this.close(1009, 'MESSAGE_TOO_LARGE');
        return;
      }
      if (this.buffer.length < size + 4) return;
      const payload = this.buffer.subarray(4, size + 4);
      this.buffer = this.buffer.subarray(size + 4);
      this.emit('message', payload, false);
    }
  }

  send(value, callback) {
    if (this.readyState !== OPEN) {
      const error = new Error('TCP transport is not open');
      if (callback) callback(error);
      return false;
    }
    const payload = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    if (!payload.length || payload.length > this.maxPayload) {
      const error = new Error('MESSAGE_TOO_LARGE');
      if (callback) callback(error);
      return false;
    }
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.length, 0);
    return this._socket.write(Buffer.concat([header, payload]), callback);
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= CLOSING) return;
    this.readyState = CLOSING;
    this.closeCode = Number(code) || 1000;
    this.closeReason = String(reason || '').slice(0, 120);
    this._socket.end();
  }

  terminate() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSING;
    this._socket.destroy();
  }
}

function connectTcp({ host, port, authorizationCode, maxPayload = DEFAULT_MAX_PAYLOAD }) {
  const socket = net.connect({ host, port });
  const peer = new TcpFrameSocket(socket, { maxPayload, open: false });
  let handshakeBuffer = Buffer.alloc(0);
  const onHandshakeData = (chunk) => {
    handshakeBuffer = handshakeBuffer.length ? Buffer.concat([handshakeBuffer, chunk]) : Buffer.from(chunk);
    if (handshakeBuffer.length > 8192) {
      peer.emit('handshake-error', { statusCode: 400, code: 'INVALID_HANDSHAKE' });
      socket.destroy();
      return;
    }
    const newline = handshakeBuffer.indexOf(0x0a);
    if (newline < 0) return;
    socket.removeListener('data', onHandshakeData);
    const line = handshakeBuffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
    const remainder = handshakeBuffer.subarray(newline + 1);
    const match = line.match(/^MINERADIO\/1\s+(\d{3})\s+([A-Z0-9_]+)(?:\s+(.*))?$/);
    if (!match || Number(match[1]) !== 200) {
      peer.emit('handshake-error', {
        statusCode: match ? Number(match[1]) : 400,
        code: match ? match[2] : 'INVALID_HANDSHAKE',
      });
      socket.destroy();
      return;
    }
    peer.activate(remainder);
    peer.emit('open');
  };
  socket.on('data', onHandshakeData);
  socket.once('connect', () => {
    const code = String(authorizationCode || '');
    socket.write(`${PROTOCOL} AUTH${code ? ` ${code}` : ''}\n`);
  });
  return peer;
}

function probeTcp({ host, port, timeoutMs = 2500 }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('TCP_PROTOCOL_TIMEOUT'), { code: 'ETIMEDOUT' })), timeoutMs);
    socket.once('connect', () => socket.write(`${PROTOCOL} PROBE\n`));
    socket.on('data', (chunk) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
      if (buffer.length > 8192) return finish(Object.assign(new Error('INVALID_HANDSHAKE'), { code: 'EPROTO' }));
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
      const match = line.match(/^MINERADIO\/1\s+(\d{3})\s+([A-Z0-9_]+)(?:\s+(.*))?$/);
      if (!match || Number(match[1]) !== 200) {
        const error = Object.assign(new Error(match ? match[2] : 'INVALID_HANDSHAKE'), {
          code: match ? match[2] : 'EPROTO', statusCode: match ? Number(match[1]) : 0,
        });
        finish(error);
        return;
      }
      try { finish(null, match[3] ? JSON.parse(match[3]) : { service: 'mineradio-together' }); }
      catch (_) { finish(Object.assign(new Error('INVALID_PROBE_RESPONSE'), { code: 'EPROTO' })); }
    });
    socket.once('error', (error) => finish(error));
  });
}

module.exports = { PROTOCOL, OPEN, CLOSED, DEFAULT_MAX_PAYLOAD, TcpFrameSocket, connectTcp, probeTcp };
