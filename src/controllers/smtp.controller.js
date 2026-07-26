const {
  verifySmtpConnection,
  sendMail,
  getMailPublicConfig,
  resetTransporter,
} = require('../services/mail.service');
const { dicaParaErroSmtp, formatMailError } = require('../shared/smtpHints');

async function statusSmtp(req, res) {
  res.json(getMailPublicConfig());
}

async function testarSmtp(req, res, next) {
  try {
    resetTransporter();
    const verify = await verifySmtpConnection();
    const config = verify.summary || getMailPublicConfig();
    if (!verify.ok) {
      return res.status(verify.skipped ? 503 : 502).json({
        ok: false,
        error: verify.error,
        dica:
          config.provider === 'brevo-api'
            ? 'Use BREVO_API_KEY (xkeysib-...) em Brevo → SMTP & API → API Keys. A chave SMTP (xsmtpsib) não serve na API.'
            : dicaParaErroSmtp(verify.error),
        config,
      });
    }

    const destino =
      (req.body?.email && String(req.body.email).trim()) ||
      process.env.MAIL_FROM?.replace(/.*<([^>]+)>.*/, '$1') ||
      process.env.MAIL_FROM ||
      null;

    if (destino) {
      const envio = await sendMail({
        to: destino,
        subject: 'PontoFácil — teste de e-mail',
        text: [
          'Este é um e-mail de teste do PontoFácil.',
          '',
          'Se você recebeu esta mensagem, o envio está configurado corretamente.',
          '',
          `Provedor: ${config.provider || 'smtp'}`,
          `Horário: ${new Date().toISOString()}`,
        ].join('\n'),
      });
      if (!envio.ok) {
        return res.status(502).json({
          ok: false,
          error: formatMailError(envio),
          config,
        });
      }
      return res.json({
        ok: true,
        mensagem: `E-mail de teste enviado para ${destino} (${config.provider || 'smtp'}).`,
        config,
      });
    }

    res.json({
      ok: true,
      mensagem: `Conexão OK (${config.provider || 'smtp'}). Informe "email" no body para enviar teste.`,
      config,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { statusSmtp, testarSmtp };
