'use strict';

const net = require('node:net');

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function isVirusScanEnabled() {
  return truthy(process.env.VIRUS_SCAN_ENABLED, false);
}

function scanConfig(options = {}) {
  return {
    host: options.host || process.env.CLAMAV_HOST || '127.0.0.1',
    port: Number(options.port || process.env.CLAMAV_PORT || 3310),
    timeout: Number(options.timeout || 10000),
    failClosed: options.failClosed === undefined
      ? truthy(process.env.VIRUS_SCAN_FAIL_CLOSED, true)
      : Boolean(options.failClosed)
  };
}

function scanBuffer(buffer, options = {}) {
  if (!isVirusScanEnabled() && options.enabled !== true) {
    return Promise.resolve({ ok: true, scanned: false });
  }
  const config = scanConfig(options);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    return Promise.resolve({ ok: !config.failClosed, scanned: false, error: 'invalid_port' });
  }
  return new Promise((resolve) => {
    let settled = false;
    let response = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const socket = net.createConnection({ host: config.host, port: config.port });
    socket.setTimeout(config.timeout);
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + chunkSize));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.includes('\0') || response.length > 4096) {
        const text = response.split('\0')[0].trim();
        if (/\bOK\b/i.test(text)) return finish({ ok: true, scanned: true });
        if (/FOUND/i.test(text)) return finish({ ok: false, scanned: true, found: true });
        return finish({ ok: !config.failClosed, scanned: true, error: 'unexpected_response' });
      }
    });
    socket.on('timeout', () => {
      finish({ ok: !config.failClosed, scanned: false, error: 'timeout' });
    });
    socket.on('error', () => {
      finish({ ok: !config.failClosed, scanned: false, error: 'connection' });
    });
    socket.on('close', () => {
      if (!settled) finish({ ok: !config.failClosed, scanned: false, error: 'closed' });
    });
  });
}

module.exports = {
  isVirusScanEnabled,
  scanBuffer
};
