import {createHash, randomBytes} from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 65_536;

export function acceptKey(key) {
  return createHash('sha1').update(String(key) + GUID).digest('base64');
}

export function isWebSocketRequest(req) {
  return req.method === 'GET'
    && String(req.headers.upgrade || '').toLowerCase() === 'websocket'
    && String(req.headers.connection || '').toLowerCase().includes('upgrade')
    && Boolean(req.headers['sec-websocket-key'])
    && String(req.headers['sec-websocket-version']) === '13';
}

export function handshakeResponse(key) {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + acceptKey(key),
    '',
    ''
  ].join('\r\n');
}

export function encodeFrame(payload, {opcode = 1, masked = false, fin = true} = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const len = data.length;
  let offset = 2;
  if (len >= 126 && len < 65536) offset = 4;
  else if (len >= 65536) offset = 10;
  const header = Buffer.alloc(offset + (masked ? 4 : 0) + len);
  header[0] = (fin ? 0x80 : 0) | opcode;
  if (len < 126) header[1] = len | (masked ? 0x80 : 0);
  else if (len < 65536) {
    header[1] = 126 | (masked ? 0x80 : 0);
    header.writeUInt16BE(len, 2);
  } else {
    header[1] = 127 | (masked ? 0x80 : 0);
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  let start = offset;
  if (masked) {
    const mask = randomBytes(4);
    mask.copy(header, offset);
    start += 4;
    for (let i = 0; i < len; i++) header[start + i] = data[i] ^ mask[i & 3];
  } else {
    data.copy(header, start);
  }
  return header;
}

export function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const n = buf.readBigUInt64BE(2);
    if (n > BigInt(MAX_FRAME)) throw new Error('frame too large');
    len = Number(n);
    offset = 10;
  }
  if (len > MAX_FRAME) throw new Error('frame too large');
  if (masked) {
    if (buf.length < offset + 4) return null;
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);
  if (masked) {
    const mask = buf.subarray(offset - 4, offset);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  return {fin, opcode, masked, payload, rest: buf.subarray(offset + len)};
}

export function attachWebSocket(socket, {head, onMessage, onClose, requireMask = true} = {}) {
  let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0);
  let closed = false;
  let pending = Buffer.alloc(0);
  socket.setTimeout(0);
  socket.setNoDelay(true);

  function send(payload, opcode = 1) {
    if (closed || socket.destroyed) return;
    try { socket.write(encodeFrame(payload, {opcode, masked: false})); } catch { close(1002); }
  }

  function close(code = 1000, reason = '') {
    if (closed) return;
    closed = true;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    try { socket.write(encodeFrame(body, {opcode: 8})); } catch { /* already gone */ }
    socket.end();
    onClose?.();
  }

  function handle(frame) {
    if (frame.opcode === 8) {
      closed = true;
      socket.end();
      onClose?.();
      return;
    }
    if (frame.opcode === 9) {
      send(frame.payload, 10);
      return;
    }
    if (frame.opcode === 10) return;
    if (frame.opcode !== 1 && frame.opcode !== 0) {
      close(1003, 'text only');
      return;
    }
    pending = frame.opcode === 1 ? frame.payload : Buffer.concat([pending, frame.payload]);
    if (!frame.fin) return;
    const text = pending.toString('utf8');
    pending = Buffer.alloc(0);
    onMessage?.(text);
  }

  socket.on('data', chunk => {
    if (closed) return;
    buf = Buffer.concat([buf, chunk]);
    try {
      while (true) {
        const frame = decodeFrame(buf);
        if (!frame) break;
        buf = frame.rest;
        if (requireMask && !frame.masked && frame.opcode !== 8) {
          close(1002, 'masked frames required');
          return;
        }
        handle(frame);
      }
    } catch {
      close(1009, 'frame too large');
    }
  });
  socket.on('error', () => close(1011));
  socket.on('end', () => {
    if (closed) return;
    closed = true;
    onClose?.();
  });

  return {sendText: text => send(text, 1), ping: () => send(Buffer.alloc(0), 9), close};
}
