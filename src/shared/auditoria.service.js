const prisma = require('../infra/prisma');

/**
 * Registro append-only de auditoria (nunca atualizar/deletar via app).
 */
async function registrarAuditoria({
  tenantId,
  entidade,
  entidadeId,
  acao,
  payloadAntes = null,
  payloadDepois = null,
  actorId = null,
  actorRole = null,
  ipHash = null,
  tx = null,
}) {
  const client = tx || prisma;
  return client.auditoriaEvento.create({
    data: {
      tenantId,
      entidade,
      entidadeId: String(entidadeId),
      acao,
      payloadAntes: payloadAntes ?? undefined,
      payloadDepois: payloadDepois ?? undefined,
      actorId,
      actorRole,
      ipHash,
    },
  });
}

function ipHashFromReq(req) {
  const crypto = require('crypto');
  return crypto
    .createHash('sha256')
    .update(req?.ip || '')
    .digest('hex')
    .substring(0, 16);
}

module.exports = { registrarAuditoria, ipHashFromReq };
