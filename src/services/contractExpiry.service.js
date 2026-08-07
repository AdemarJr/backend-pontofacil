// src/services/contractExpiry.service.js — suspende tenants com contrato vencido (sem n8n)
const prisma = require('../infra/prisma');
const { inicioDoDia } = require('../shared/contractCheck');

/**
 * Suspende empresas ATIVAS cujo contractEndDate já passou (dia do fim ainda é válido).
 * Compara por calendário: fim em 07/08 só suspende a partir de 08/08 00:00.
 */
async function suspenderContratosExpirados() {
  const inicioHoje = inicioDoDia();

  const candidatos = await prisma.tenant.findMany({
    where: {
      status: 'ATIVO',
      periodoContrato: { not: null },
      contractEndDate: { not: null, lt: inicioHoje },
    },
    select: { id: true, nomeFantasia: true, contractEndDate: true, periodoContrato: true },
  });

  if (candidatos.length > 0) {
    await prisma.tenant.updateMany({
      where: { id: { in: candidatos.map((t) => t.id) } },
      data: { status: 'SUSPENSO' },
    });
    console.log(`[contrato] ${candidatos.length} empresa(s) suspensa(s) por contrato vencido.`);
  }

  return { suspensos: candidatos.length, tenants: candidatos };
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
