// src/services/contractExpiry.service.js — suspende tenants com contrato vencido (sem n8n)
const prisma = require('../infra/prisma');

async function suspenderContratosExpirados() {
  const hoje = new Date();
  hoje.setHours(23, 59, 59, 999);

  const expirados = await prisma.tenant.findMany({
    where: {
      contractEndDate: { lt: hoje },
      status: 'ATIVO',
      periodoContrato: { not: null },
    },
    select: { id: true, nomeFantasia: true, contractEndDate: true, periodoContrato: true },
  });

  if (expirados.length > 0) {
    await prisma.tenant.updateMany({
      where: { id: { in: expirados.map((t) => t.id) } },
      data: { status: 'SUSPENSO' },
    });
    console.log(`[contrato] ${expirados.length} empresa(s) suspensa(s) por contrato vencido.`);
  }

  return { suspensos: expirados.length, tenants: expirados };
}

function iniciarJobVerificacaoContratos(intervaloMs = 6 * 60 * 60 * 1000) {
  const rodar = () => {
    suspenderContratosExpirados().catch((err) => {
      console.error('[contrato] Falha ao verificar contratos:', err?.message || err);
    });
  };

  rodar();
  const timer = setInterval(rodar, intervaloMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = { suspenderContratosExpirados, iniciarJobVerificacaoContratos };
