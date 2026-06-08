// Leitura confiável de feature flags por tenant (Prisma + SQL direto)
const prisma = require('../infra/prisma');

function normalizarFeatures(tenantId, row) {
  if (!row) {
    return { tenantId, payrollModuleEnabled: false };
  }
  const v = row.payrollModuleEnabled;
  return {
    tenantId: row.tenantId || tenantId,
    payrollModuleEnabled: v === true || v === 'true' || v === 1 || v === 't',
  };
}

async function lerFeaturesDoTenant(tenantId) {
  if (!tenantId) {
    return { tenantId: null, payrollModuleEnabled: false };
  }

  try {
    const row = await prisma.tenantFeature.findUnique({
      where: { tenantId },
      select: { tenantId: true, payrollModuleEnabled: true },
    });
    if (row) return normalizarFeatures(tenantId, row);
  } catch {
    // Prisma indisponível ou schema desatualizado — tenta SQL
  }

  try {
    const rows = await prisma.$queryRaw`
      SELECT "tenantId", "payrollModuleEnabled"
      FROM "tenant_features"
      WHERE "tenantId" = ${tenantId}
      LIMIT 1
    `;
    const row = Array.isArray(rows) ? rows[0] : null;
    return normalizarFeatures(tenantId, row);
  } catch {
    return { tenantId, payrollModuleEnabled: false };
  }
}

module.exports = { lerFeaturesDoTenant, normalizarFeatures };
