const prisma = require('../../infra/prisma');

/**
 * Aloca o próximo NSR do tenant de forma atômica (Portaria 671 — sequência por estabelecimento).
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
async function alocarNsr(tenantId, tx) {
  const client = tx || prisma;
  const rows = await client.$queryRaw`
    UPDATE tenants
    SET "proximoNsr" = "proximoNsr" + 1
    WHERE id = ${tenantId}
    RETURNING "proximoNsr" - 1 AS nsr
  `;
  const nsr = rows?.[0]?.nsr;
  if (nsr == null || Number(nsr) < 1) {
    throw new Error('Falha ao alocar NSR');
  }
  return Number(nsr);
}

module.exports = { alocarNsr };
