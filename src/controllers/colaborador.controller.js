const prisma = require('../infra/prisma');
const { CONSENTIMENTO_VERSAO_ATUAL } = require('../shared/consentimento');

async function statusConsentimento(req, res, next) {
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id: req.usuario.id, tenantId: req.tenantId },
      select: {
        consentimentoDadosEm: true,
        consentimentoDadosVersao: true,
      },
    });
    const aceito =
      Boolean(usuario?.consentimentoDadosEm) &&
      usuario.consentimentoDadosVersao === CONSENTIMENTO_VERSAO_ATUAL;
    return res.json({
      aceito,
      versaoAtual: CONSENTIMENTO_VERSAO_ATUAL,
      consentimentoDadosEm: usuario?.consentimentoDadosEm || null,
    });
  } catch (err) {
    next(err);
  }
}

async function registrarConsentimento(req, res, next) {
  try {
    const { versao } = req.body || {};
    if (versao && versao !== CONSENTIMENTO_VERSAO_ATUAL) {
      return res.status(400).json({
        error: 'Versão do termo desatualizada. Recarregue a página.',
        versaoAtual: CONSENTIMENTO_VERSAO_ATUAL,
      });
    }
    await prisma.usuario.updateMany({
      where: { id: req.usuario.id, tenantId: req.tenantId },
      data: {
        consentimentoDadosEm: new Date(),
        consentimentoDadosVersao: CONSENTIMENTO_VERSAO_ATUAL,
      },
    });
    return res.json({ sucesso: true, versao: CONSENTIMENTO_VERSAO_ATUAL });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  CONSENTIMENTO_VERSAO_ATUAL,
  statusConsentimento,
  registrarConsentimento,
};
