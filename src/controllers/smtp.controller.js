const {
  verifySmtpConnection,
  sendMail,
  getSmtpPublicConfig,
  resetTransporter,
} = require('../services/mail.service');
const { dicaParaErroSmtp, formatMailError } = require('../shared/smtpHints');

async function statusSmtp(req, res) {
  const config = getSmtpPublicConfig();
  res.json(config);
}

async function testarSmtp(req, res, next) {
  try {
    resetTransporter();
    const verify = await verifySmtpConnection();
    if (!verify.ok) {
      return res.status(verify.skipped ? 503 : 502).json({
        ok: false,
        error: verify.error,
        dica: dicaParaErroSmtp(verify.error),
        config: verify.summary || getSmtpPublicConfig(),
      });
    }

    const destino =
      (req.body?.email && String(req.body.email).trim()) ||
      getSmtpPublicConfig().user ||
      null;

    if (destino) {
      const envio = await sendMail({
        to: destino,
        subject: 'PontoFácil — teste SMTP',
        text: [
          'Este é um e-mail de teste do PontoFácil.',
          '',
          'Se você recebeu esta mensagem, o SMTP está configurado corretamente.',
          '',
          `Horário: ${new Date().toISOString()}`,
        ].join('\n'),
      });
      if (!envio.ok) {
        return res.status(502).json({
          ok: false,
          error: formatMailError(envio),
          config: verify.summary,
        });
      }
      return res.json({
        ok: true,
        mensagem: `Conexão SMTP OK. E-mail de teste enviado para ${destino}.`,
        config: verify.summary,
      });
    }

    res.json({
      ok: true,
      mensagem: 'Conexão SMTP OK (login verificado). Informe "email" no body para enviar teste.',
      config: verify.summary,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { statusSmtp, testarSmtp };
