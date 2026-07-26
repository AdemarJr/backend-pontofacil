/**
 * Brevo — envio via API HTTPS (porta 443).
 * Recomendado no Railway quando SMTP (587/465) dá timeout.
 * Chave: Brevo → SMTP & API → API Keys (xkeysib-..., não a chave SMTP xsmtpsib-).
 */

const BREVO_API = 'https://api.brevo.com/v3';

function readBrevoApiKey() {
  const key = process.env.BREVO_API_KEY || process.env.BREVO_API_KEY_V3;
  return key ? String(key).trim() : '';
}

function isBrevoApiConfigured() {
  return readBrevoApiKey().length > 0;
}

/** @param {string} fromRaw ex.: "PontoFácil" <a@b.com> ou a@b.com */
function parseSender(fromRaw) {
  const raw = String(fromRaw || '').trim();
  const angled = raw.match(/^"([^"]*)"\s*<([^>]+)>$/);
  if (angled) {
    return { name: angled[1].trim() || 'PontoFácil', email: angled[2].trim() };
  }
  const simple = raw.match(/^<([^>]+)>$/);
  if (simple) {
    return { name: 'PontoFácil', email: simple[1].trim() };
  }
  if (raw.includes('@')) {
    return { name: 'PontoFácil', email: raw };
  }
  return null;
}

async function brevoFetch(path, options = {}) {
  const apiKey = readBrevoApiKey();
  const res = await fetch(`${BREVO_API}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `Brevo HTTP ${res.status}`);
    err.statusCode = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

async function verifyBrevoApi() {
  if (!isBrevoApiConfigured()) {
    return {
      ok: false,
      skipped: true,
      error: 'BREVO_API_KEY ausente. Gere em Brevo → SMTP & API → API Keys (xkeysib-...).',
    };
  }
  try {
    const account = await brevoFetch('/account', { method: 'GET' });
    return {
      ok: true,
      summary: {
        provider: 'brevo-api',
        email: account.email || null,
        companyName: account.companyName || null,
        apiKeyConfigured: true,
      },
    };
  } catch (e) {
    console.error('[mail/brevo] verify falhou:', e.message, e.details || '');
    return {
      ok: false,
      error: e.message || String(e),
      summary: { provider: 'brevo-api', apiKeyConfigured: true },
    };
  }
}

/**
 * @param {{ to: string; subject: string; text: string; html?: string; fromRaw: string }} opts
 */
async function sendViaBrevoApi(opts) {
  const { to, subject, text, html, fromRaw } = opts;
  if (!isBrevoApiConfigured()) {
    return { ok: false, skipped: true, reason: 'brevo_api_nao_configurado' };
  }

  const sender = parseSender(fromRaw);
  if (!sender?.email) {
    return { ok: false, skipped: true, reason: 'mail_from_ausente' };
  }

  try {
    await brevoFetch('/smtp/email', {
      method: 'POST',
      body: JSON.stringify({
        sender,
        to: [{ email: String(to).trim() }],
        subject,
        htmlContent: html || String(text || '').replace(/\n/g, '<br/>'),
        textContent: text,
      }),
    });
    return { ok: true };
  } catch (e) {
    console.error('[mail/brevo] send falhou:', e.message, JSON.stringify(e.details || {}));
    return {
      ok: false,
      skipped: false,
      reason: 'falha_envio',
      error: e.message || String(e),
    };
  }
}

module.exports = {
  isBrevoApiConfigured,
  readBrevoApiKey,
  verifyBrevoApi,
  sendViaBrevoApi,
  parseSender,
};
