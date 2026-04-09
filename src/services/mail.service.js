const nodemailer = require('nodemailer');

function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

let transporter;

function getTransporter() {
  if (!isMailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER != null && process.env.SMTP_USER !== ''
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
          : undefined,
    });
  }
  return transporter;
}

/**
 * @param {{ to: string; subject: string; text: string; html?: string }} opts
 * @returns {Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }>}
 */
async function sendMail(opts) {
  const { to, subject, text, html } = opts;
  const t = getTransporter();
  if (!t) {
    console.warn('[mail] SMTP não configurado (SMTP_HOST / MAIL_FROM) — e-mail não enviado para', to);
    return { ok: false, skipped: true, reason: 'smtp_nao_configurado' };
  }
  if (process.env.SMTP_USER === undefined || process.env.SMTP_USER === '') {
    console.warn(
      '[mail] SMTP_USER vazio — muitos provedores (ex.: Hostinger) exigem autenticação. Envio pode falhar. Destino:',
      to
    );
  }
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text,
      html: html || text.replace(/\n/g, '<br/>'),
    });
    return { ok: true };
  } catch (e) {
    console.error('[mail] Falha ao enviar:', e?.message || e);
    return { ok: false, skipped: false, reason: 'falha_envio', error: e?.message || String(e) };
  }
}

module.exports = { sendMail, isMailConfigured };
