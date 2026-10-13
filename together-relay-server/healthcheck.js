'use strict';

const net = require('net');

const host = String(process.env.HEALTHCHECK_HOST || '127.0.0.1');
const port = Number(process.env.PORT || 17861);
const socket = net.connect({ host, port });
let buffer = Buffer.alloc(0);
let finished = false;

function finish(ok, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  socket.destroy();
  if (!ok && message) console.error(message);
  process.exit(ok ? 0 : 1);
}

const timer = setTimeout(() => finish(false, 'healthcheck timed out'), 3000);
socket.once('connect', () => socket.write('MINERADIO/1 PROBE\n'));
socket.on('data', (chunk) => {
  buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
  if (buffer.length > 8192) return finish(false, 'invalid healthcheck response');
  const newline = buffer.indexOf(0x0a);
  if (newline < 0) return;
  const line = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
  const match = line.match(/^MINERADIO\/1 200 OK (.+)$/);
  if (!match) return finish(false, 'unexpected healthcheck response');
  try {
    const payload = JSON.parse(match[1]);
    finish(payload.service === 'mineradio-together', 'unexpected service identity');
  } catch (_) {
    finish(false, 'invalid healthcheck JSON');
  }
});
socket.once('error', (error) => finish(false, error.code || error.message));
