// Limites de colaboradores por plano comercial (ou enum legado)
const prisma = require('../infra/prisma');

const LIMITES_ENUM = {
  BASICO: 10,
  PROFISSIONAL: 50,
  ENTERPRISE: null,
};

function mapearEnumPorMaxColaboradores(max) {
  if (max == null) return 'ENTERPRISE';
  if (max <= 10) return 'BASICO';
  if (max <= 50) return 'PROFISSIONAL';
  return 'ENTERPRISE';
}

async function obterPlanoDoTenant(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { planoComercial: true },
  });
  if (!tenant) return null;
  return {
    tenant,
    planoComercial: tenant.planoComercial,
    maxColaboradores:
      tenant.planoComercial?.maxColaboradores ??
      LIMITES_ENUM[tenant.plano] ??
      10,
  };
}

async function contarColaboradoresAtivos(tenantId) {
  return prisma.usuario.count({ where: { tenantId, ativo: true } });
}

async function assertPodeAdicionarColaborador(tenantId, extra = 1) {
  const info = await obterPlanoDoTenant(tenantId);
  if (!info) {
    const err = new Error('Empresa não encontrada');
    err.status = 404;
    throw err;
  }
  const { maxColaboradores } = info;
  if (maxColaboradores == null) return info;
  const atual = await contarColaboradoresAtivos(tenantId);
  if (atual + extra > maxColaboradores) {
    const err = new Error(
      `Limite do plano atingido (${atual}/${maxColaboradores} colaboradores). Faça upgrade do plano para cadastrar mais pessoas.`
    );
    err.status = 403;
    err.code = 'PLAN_USER_LIMIT';
    throw err;
  }
  return info;
}

module.exports = {
  LIMITES_ENUM,
  mapearEnumPorMaxColaboradores,
  obterPlanoDoTenant,
  contarColaboradoresAtivos,
  assertPodeAdicionarColaborador,
};
