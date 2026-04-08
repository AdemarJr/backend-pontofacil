const crypto = require('crypto');

function getKey() {
  const raw = process.env.PIN_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) return null;
  return buf;
}

function encryptPin(pin) {
  const key = getKey();
  if (!key) {
    const err = new Error('PIN_ENCRYPTION_KEY inválida/ausente (esperado base64 de 32 bytes)');
    err.status = 500;
    throw err;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(pin), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // formato: iv.tag.ciphertext (base64)
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

function decryptPin(payload) {
  const key = getKey();
  if (!key) {
    const err = new Error('PIN_ENCRYPTION_KEY inválida/ausente (esperado base64 de 32 bytes)');
    err.status = 500;
    throw err;
  }
  if (!payload || typeof payload !== 'string') return null;
  const [ivB64, tagB64, ctB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !ctB64) return null;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptPin, decryptPin };

