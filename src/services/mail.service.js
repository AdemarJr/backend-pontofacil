const nodemailer = require('nodemailer');

/**
 * Endereço "From" — muitos provedores rejeitam se não bater com SMTP_USER.
 * Se MAIL_FROM não existir, usa o mesmo e-mail da autenticação.
 */
function resolveMailFrom() {
  const explicit = process.env.MAIL_FROM;
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  const user = process.env.SMTP_USER;
  if (user && String(user).trim()) return `"PontoFácil" <${String(user).trim()}>`;
  return null;
}

function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && resolveMailFrom());
}

/**
 * Porta 465 = SSL direto (secure: true). Porta 587 = STARTTLS (secure: false + requireTLS).
 * Erro comum: porta 465 sem SMTP_SECURE=true — a conexão nunca completa.
 */
function resolvePortAndSecure() {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const raw = (process.env.SMTP_SECURE || '').toLowerCase();
  let secure;
  if (raw === '1' || raw === 'true') secure = true;
  else if (raw === '0' || raw === 'false') secure = false;
  else secure = port === 465;

  const requireTLS = !secure && (port === 587 || port === 2587);

  return { port, secure, requireTLS };
}

function buildTransportOptions() {
  const { port, secure, requireTLS } = resolvePortAndSecure();
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const auth =
    user != null && String(user).trim() !== ''
      ? { user: String(user).trim(), pass: pass != null ? String(pass) : '' }
      : undefined;

  const rejectUnauthorized =
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED === '0' ||
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false'
      ? false
      : true;

  const opts = {
    host: process.env.SMTP_HOST,
    port,
    secure,
    ...(requireTLS ? { requireTLS: true } : {}),
    auth,
    connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT_MS || '10000', 10),
    greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT_MS || '10000', 10),
    socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS || '25000', 10),
    tls: { rejectUnauthorized },
  };

  if (process.env.SMTP_DEBUG === '1' || process.env.SMTP_DEBUG === 'true') {
    opts.debug = true;
    opts.logger = true;
  }

  return opts;
}

let transporter;

function getTransporter() {
  if (!isMailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport(buildTransportOptions());
  }
  return transporter;
}

/** Limpa o transporter (útil após falha de conexão ou mudança de env em runtime). */
function resetTransporter() {
  transporter = null;
}

function logSmtpSendError(e, to) {
  const extra = {
    to,
    code: e?.code,
    command: e?.command,
    responseCode: e?.responseCode,
    response: e?.response,
  };
  console.error('[mail] Falha ao enviar:', e?.message || e, JSON.stringify(extra));
}

/**
 * Testa login + handshake com o servidor SMTP (sem enviar mensagem).
 * @returns {Promise<{ ok: boolean; skipped?: boolean; error?: string; summary?: object }>}
 */
async function verifySmtpConnection() {
  if (!isMailConfigured()) {
    return { ok: false, skipped: true, error: 'SMTP_HOST ou remetente (MAIL_FROM / SMTP_USER) ausente' };
  }
  const { port, secure } = resolvePortAndSecure();
  const summary = {
    host: process.env.SMTP_HOST,
    port,
    secure,
    hasAuth: Boolean(process.env.SMTP_USER && String(process.env.SMTP_USER).trim()),
    from: resolveMailFrom()?.replace(/<[^>]+>/, '<…>') || null,
  };

  const t = getTransporter();
  if (!t) return { ok: false, skipped: true, error: 'Transporter não criado', summary };

  try {
    await t.verify();
    return { ok: true, summary };
  } catch (e) {
    logSmtpSendError(e, '(verify)');
    resetTransporter();
    return { ok: false, error: e?.message || String(e), summary };
  }
}

if (process.env.SMTP_VERIFY_ON_START === '1' || process.env.SMTP_VERIFY_ON_START === 'true') {
  setImmediate(() => {
    verifySmtpConnection().then((r) => {
      if (r.ok) console.log('[mail] Verificação SMTP ao subir: OK', r.summary);
      else if (r.skipped) console.warn('[mail] Verificação SMTP ao subir: ignorada (não configurado)');
      else console.error('[mail] Verificação SMTP ao subir: FALHOU —', r.error, r.summary);
    });
  });
}

/**
 * @param {{ to: string; subject: string; text: string; html?: string }} opts
 * @returns {Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }>}
 */
async function sendMail(opts) {
  const { to, subject, text, html } = opts;
  const from = resolveMailFrom();
  const t = getTransporter();
  if (!t || !from) {
    console.warn('[mail] SMTP não configurado (SMTP_HOST + MAIL_FROM ou SMTP_USER) — e-mail não enviado para', to);
    return { ok: false, skipped: true, reason: 'smtp_nao_configurado' };
  }

  if (!process.env.SMTP_USER || String(process.env.SMTP_USER).trim() === '') {
    console.warn(
      '[mail] SMTP_USER vazio — a maioria dos provedores exige autenticação. Destino:',
      to
    );
  }

  try {
    await t.sendMail({
      from,
      to,
      subject,
      text,
      html: html || text.replace(/\n/g, '<br/>'),
    });
    return { ok: true };
  } catch (e) {
    logSmtpSendError(e, to);
    if (e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET' || e?.code === 'ESOCKET') {
      resetTransporter();
    }
    return { ok: false, skipped: false, reason: 'falha_envio', error: e?.message || String(e) };
  }
}

module.exports = { sendMail, isMailConfigured, verifySmtpConnection, resetTransporter };
