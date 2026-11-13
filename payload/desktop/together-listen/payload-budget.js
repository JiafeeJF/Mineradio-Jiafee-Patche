'use strict';

const MAX_SERIALIZED_PAYLOAD_BYTES = 64 * 1024;
// Leave room for counters and timestamps to grow after an accepted state change.
const MAX_ROOM_BROADCAST_BYTES = MAX_SERIALIZED_PAYLOAD_BYTES - 1024;

function inspectJsonPayload(value, maxBytes = MAX_SERIALIZED_PAYLOAD_BYTES) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    return { ok: false, code: 'PAYLOAD_NOT_SERIALIZABLE', error, text: '', bytes: 0, maxBytes };
  }
  if (typeof text !== 'string') {
    return { ok: false, code: 'PAYLOAD_NOT_SERIALIZABLE', text: '', bytes: 0, maxBytes };
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (!bytes || bytes > maxBytes) {
    return { ok: false, code: bytes ? 'PAYLOAD_TOO_LARGE' : 'PAYLOAD_EMPTY', text, bytes, maxBytes };
  }
  return { ok: true, code: '', text, bytes, maxBytes };
}

module.exports = { MAX_SERIALIZED_PAYLOAD_BYTES, MAX_ROOM_BROADCAST_BYTES, inspectJsonPayload };
