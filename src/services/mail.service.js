const nodemailer = require('nodemailer');
const {
  isBrevoApiConfigured,
  verifyBrevoApi,
  sendViaBrevoApi,
} = require('./brevoMail.service');

/**
 * Endereço "From" — muitos provedores rejeitam se não bater com SMTP_USER.
 * Se MAIL_FROM não existir, usa o mesmo e-mail da autenticação.
 */
function resolveMailFrom() {
  const explicit = process.env.MAIL_FROM;
  if (explicit && String(explicit).trim()) {
    const v = String(explicit).trim();
    if (v.includes('<') && v.includes('>')) return v;
    return `"PontoFácil" <${v}>`;
  }
  const user = process.env.SMTP_USER;
  if (user && String(user).trim()) return `"PontoFácil" <${String(user).trim()}>`;
  return null;
}

function getMailProvider() {
  const raw = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase();
  if (raw === 'brevo-api' || raw === 'brevo') return 'brevo-api';
  if (raw === 'smtp') return 'smtp';
  if (isBrevoApiConfigured()) return 'brevo-api';
  return 'smtp';
}

function readSmtpPass() {
  const raw = process.env.SMTP_PASS;
  if (raw == null) return '';
  return String(raw).trim();
}

function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && resolveMailFrom() && readSmtpPass());
}

function isMailConfigured() {
  if (getMailProvider() === 'brevo-api') {
    return isBrevoApiConfigured() && Boolean(resolveMailFrom());
  }
  return isSmtpConfigured();
}

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
  const pass = readSmtpPass();

  const auth =
    user != null && String(user).trim() !== ''
      ? { user: String(user).trim(), pass }
      : undefined;

  const rejectUnauthorized =
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED === '0' ||
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false'
      ? false
      : true;

  const useIpv4 = process.env.SMTP_IPV4 !== '0' && process.env.SMTP_IPV4 !== 'false';

  const opts = {
    host: process.env.SMTP_HOST,
    port,
    secure,
    ...(requireTLS ? { requireTLS: true } : {}),
    auth,
    ...(useIpv4 ? { family: 4 } : {}),
    connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT_MS || '15000', 10),
    greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT_MS || '15000', 10),
    socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS || '30000', 10),
    tls: { rejectUnauthorized, minVersion: 'TLSv1.2' },
  };

  if (process.env.SMTP_DEBUG === '1' || process.env.SMTP_DEBUG === 'true') {
    opts.debug = true;
    opts.logger = true;
  }

  return opts;
}

let transporter;

function getTransporter() {
  if (!isSmtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport(buildTransportOptions());
  }
  return transporter;
}

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
    smtpPassLength: readSmtpPass().length,
  };
  console.error('[mail/smtp] Falha ao enviar:', e?.message || e, JSON.stringify(extra));
}

function getMailPublicConfig() {
  const provider = getMailProvider();
  const from = resolveMailFrom()?.replace(/<[^>]+>/, '<…>') || null;

  if (provider === 'brevo-api') {
    return {
      provider: 'brevo-api',
      configured: isMailConfigured(),
      from,
      brevoApiKeyConfigured: isBrevoApiConfigured(),
    };
  }

  const { port, secure } = resolvePortAndSecure();
  return {
    provider: 'smtp',
    host: process.env.SMTP_HOST || null,
    port,
    secure,
    user: process.env.SMTP_USER ? String(process.env.SMTP_USER).trim() : null,
    from,
    passConfigured: readSmtpPass().length > 0,
    passLength: readSmtpPass().length,
    configured: isMailConfigured(),
  };
}

/** @deprecated use getMailPublicConfig */
function getSmtpPublicConfig() {
  return getMailPublicConfig();
}

async function verifySmtpConnection() {
  if (getMailProvider() === 'brevo-api') {
    return verifyBrevoApi();
  }

  if (!isSmtpConfigured()) {
    return { ok: false, skipped: true, error: 'SMTP_HOST, SMTP_PASS ou remetente (MAIL_FROM) ausente' };
  }

  resetTransporter();
  const summary = getMailPublicConfig();
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
      if (r.ok) console.log('[mail] Verificação ao subir: OK', r.summary);
      else if (r.skipped) console.warn('[mail] Verificação ao subir: ignorada (não configurado)');
      else console.error('[mail] Verificação ao subir: FALHOU —', r.error, r.summary);
    });
  });
}

async function sendMailViaSmtp(opts) {
  const { to, subject, text, html } = opts;
  const from = resolveMailFrom();
  const t = getTransporter();
  if (!t || !from) {
    return { ok: false, skipped: true, reason: 'smtp_nao_configurado' };
  }
  if (!readSmtpPass()) {
    return { ok: false, skipped: true, reason: 'smtp_sem_senha' };
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
    resetTransporter();
    return { ok: false, skipped: false, reason: 'falha_envio', error: e?.message || String(e) };
  }
}

/**
 * @param {{ to: string; subject: string; text: string; html?: string }} opts
 */
async function sendMail(opts) {
  const from = resolveMailFrom();
  if (!from) {
    console.warn('[mail] MAIL_FROM ausente — e-mail não enviado para', opts.to);
    return { ok: false, skipped: true, reason: 'mail_from_ausente' };
  }

  if (getMailProvider() === 'brevo-api') {
    return sendViaBrevoApi({ ...opts, fromRaw: from });
  }

  return sendMailViaSmtp(opts);
}

module.exports = {
  sendMail,
  isMailConfigured,
  verifySmtpConnection,
  resetTransporter,
  getMailPublicConfig,
  getSmtpPublicConfig,
  getMailProvider,
};
