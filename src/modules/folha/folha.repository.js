// src/modules/folha/folha.repository.js
const prisma = require('../../infra/prisma');
const { tabelas2025 } = require('./payroll.engine');

const DEFAULT_CONFIG = {
  modoBancoHoras: 'COMPENSAR',
  heDiaUtilPercent: 50,
  heDomingoFeriadoPercent: 100,
  adicionalNoturnoPercent: 20,
  pagarDSR: true,
  permitirFolhaSemAssinatura: false,
  vtPercentMax: 6,
  vtProporcionalFaltas: true,
  descontarAtrasos: false,
  descontoAtrasoDiarioPercent: 25,
  descontarIntervaloInsuficiente: false,
  descontoIntervaloDiarioPercent: 25,
  adiantamentoPercent: 40,
  descontarAdiantamentoNaFolha: true,
  tabelasVersao: tabelas2025.versao,
  tabelasSnapshot: tabelas2025,
};

async function getOrCreateConfig(tenantId) {
  let config = await prisma.folhaConfig.findUnique({ where: { tenantId } });
  if (!config) {
    config = await prisma.folhaConfig.create({
      data: { tenantId, ...DEFAULT_CONFIG },
    });
  }
  return config;
}

async function updateConfig(tenantId, data) {
  await getOrCreateConfig(tenantId);
  return prisma.folhaConfig.update({ where: { tenantId }, data });
}

async function findRun(tenantId, mes, ano) {
  return prisma.folhaRun.findUnique({
    where: { tenantId_mes_ano: { tenantId, mes, ano } },
    include: {
      holerites: {
        include: {
          usuario: {
            select: { id: true, nome: true, email: true, cargo: true, cpf: true },
          },
        },
        orderBy: { usuario: { nome: 'asc' } },
      },
      fechadaPor: { select: { id: true, nome: true } },
    },
  });
}

async function findRunById(tenantId, runId) {
  return prisma.folhaRun.findFirst({
    where: { id: runId, tenantId },
    include: {
      holerites: {
        include: {
          usuario: {
            select: {
              id: true, nome: true, email: true, cargo: true, cpf: true,
              contaBanco: true, contaAgencia: true, contaNumero: true, contaTipo: true,
            },
          },
        },
        orderBy: { usuario: { nome: 'asc' } },
      },
      fechadaPor: { select: { id: true, nome: true } },
    },
  });
}

async function listRuns(tenantId, { mes, ano } = {}) {
  return prisma.folhaRun.findMany({
    where: {
      tenantId,
      ...(mes && { mes: Number(mes) }),
      ...(ano && { ano: Number(ano) }),
    },
    include: {
      _count: { select: { holerites: true } },
      fechadaPor: { select: { id: true, nome: true } },
    },
    orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
  });
}

async function upsertRunWithHolerites(tenantId, mes, ano, { status, bloqueadaPorPendencias, holerites }) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.folhaRun.upsert({
      where: { tenantId_mes_ano: { tenantId, mes, ano } },
      create: {
        tenantId, mes, ano, status,
        calculadaEm: new Date(),
        bloqueadaPorPendencias: bloqueadaPorPendencias || null,
      },
      update: {
        status,
        calculadaEm: new Date(),
        bloqueadaPorPendencias: bloqueadaPorPendencias || null,
      },
    });

    await tx.holerite.deleteMany({ where: { folhaRunId: run.id } });

    if (holerites?.length) {
      await tx.holerite.createMany({
        data: holerites.map((h) => ({
          folhaRunId: run.id,
          usuarioId: h.usuarioId,
          proventos: h.proventos,
          descontos: h.descontos,
          bases: h.bases,
          liquido: h.liquido,
        })),
      });
    }

    return tx.folhaRun.findUnique({
      where: { id: run.id },
      include: {
        holerites: {
          include: { usuario: { select: { id: true, nome: true, cargo: true, cpf: true } } },
        },
      },
    });
  });
}

async function fecharRun(tenantId, runId, fechadaPorId, pdfUpdates) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.folhaRun.update({
      where: { id: runId },
      data: {
        status: 'FECHADA',
        fechadaEm: new Date(),
        fechadaPorId,
      },
    });

    if (pdfUpdates?.length) {
      for (const u of pdfUpdates) {
        await tx.holerite.update({
          where: { id: u.holeriteId },
          data: { pdfKey: u.pdfKey || null },
        });
      }
    }

    return run;
  });
}

async function findHolerite(tenantId, holeriteId) {
  return prisma.holerite.findFirst({
    where: { id: holeriteId, folhaRun: { tenantId } },
    include: {
      usuario: true,
      folhaRun: { include: { tenant: true } },
    },
  });
}

async function listColaboradoresCLT(tenantId) {
  return prisma.usuario.findMany({
    where: { tenantId, role: 'COLABORADOR', ativo: true, tipoContrato: 'CLT' },
    select: {
      id: true, nome: true, cargo: true, cpf: true, salarioBase: true,
      tipoContrato: true, dependentesIrrf: true,
      dataAdmissao: true, dataDemissao: true,
      contaBanco: true, contaAgencia: true, contaNumero: true, contaTipo: true,
      usaVt: true, valorVtMensal: true,
      descontoVaMensal: true, descontoPlanoSaudeMensal: true,
    },
  });
}

async function findUsuarioCLT(tenantId, usuarioId) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, tenantId, role: 'COLABORADOR', tipoContrato: 'CLT' },
    select: {
      id: true, nome: true, cargo: true, cpf: true, salarioBase: true,
      tipoContrato: true, dependentesIrrf: true,
      dataAdmissao: true, dataDemissao: true,
    },
  });
}

async function createFeriasPagamento(tenantId, data) {
  return prisma.feriasPagamento.create({
    data: { tenantId, ...data },
    include: {
      usuario: { select: { id: true, nome: true, cpf: true, cargo: true } },
      ferias: { select: { id: true, dataInicio: true, dataFim: true, status: true } },
    },
  });
}

async function listFeriasPagamentos(tenantId, { usuarioId, ano } = {}) {
  return prisma.feriasPagamento.findMany({
    where: {
      tenantId,
      ...(usuarioId && { usuarioId }),
      ...(ano && { anoReferencia: Number(ano) }),
    },
    include: {
      usuario: { select: { id: true, nome: true, cpf: true, cargo: true } },
      ferias: { select: { id: true, dataInicio: true, dataFim: true } },
    },
    orderBy: [{ anoReferencia: 'desc' }, { mesReferencia: 'desc' }, { calculadaEm: 'desc' }],
  });
}

async function findFeriasPagamento(tenantId, id) {
  return prisma.feriasPagamento.findFirst({
    where: { id, tenantId },
    include: {
      usuario: true,
      ferias: true,
      tenant: { select: { razaoSocial: true, nomeFantasia: true, cnpj: true } },
    },
  });
}

async function upsertDecimoRun(tenantId, ano, parcela, holerites) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.decimoTerceiroRun.upsert({
      where: { tenantId_ano_parcela: { tenantId, ano, parcela } },
      create: { tenantId, ano, parcela, status: 'CALCULADA', calculadaEm: new Date() },
      update: { status: 'CALCULADA', calculadaEm: new Date() },
    });

    await tx.decimoTerceiroHolerite.deleteMany({ where: { runId: run.id } });

    if (holerites?.length) {
      await tx.decimoTerceiroHolerite.createMany({
        data: holerites.map((h) => ({
          runId: run.id,
          usuarioId: h.usuarioId,
          mesesTrabalhados: h.mesesTrabalhados,
          proventos: h.proventos,
          descontos: h.descontos,
          bases: h.bases,
          liquido: h.liquido,
        })),
      });
    }

    return tx.decimoTerceiroRun.findUnique({
      where: { id: run.id },
      include: {
        holerites: {
          include: { usuario: { select: { id: true, nome: true, cpf: true, cargo: true } } },
          orderBy: { usuario: { nome: 'asc' } },
        },
      },
    });
  });
}

async function listDecimoRuns(tenantId, { ano } = {}) {
  return prisma.decimoTerceiroRun.findMany({
    where: { tenantId, ...(ano && { ano: Number(ano) }) },
    include: { _count: { select: { holerites: true } } },
    orderBy: [{ ano: 'desc' }, { parcela: 'asc' }],
  });
}

async function findDecimoRunById(tenantId, runId) {
  return prisma.decimoTerceiroRun.findFirst({
    where: { id: runId, tenantId },
    include: {
      holerites: {
        include: { usuario: { select: { id: true, nome: true, cpf: true, cargo: true } } },
        orderBy: { usuario: { nome: 'asc' } },
      },
    },
  });
}

async function findDecimoHolerite(tenantId, holeriteId) {
  return prisma.decimoTerceiroHolerite.findFirst({
    where: { id: holeriteId, run: { tenantId } },
    include: {
      usuario: true,
      run: { include: { tenant: { select: { razaoSocial: true, nomeFantasia: true, cnpj: true } } } },
    },
  });
}

async function createRescisao(tenantId, data) {
  return prisma.rescisao.create({
    data: { tenantId, ...data },
    include: {
      usuario: { select: { id: true, nome: true, cpf: true, cargo: true } },
    },
  });
}

async function listRescisoes(tenantId, { usuarioId } = {}) {
  return prisma.rescisao.findMany({
    where: { tenantId, ...(usuarioId && { usuarioId }) },
    include: {
      usuario: { select: { id: true, nome: true, cpf: true, cargo: true } },
    },
    orderBy: { dataDesligamento: 'desc' },
  });
}

async function findRescisao(tenantId, id) {
  return prisma.rescisao.findFirst({
    where: { id, tenantId },
    include: {
      usuario: true,
      tenant: { select: { razaoSocial: true, nomeFantasia: true, cnpj: true } },
    },
  });
}

async function upsertAdiantamentoRun(tenantId, mes, ano, percent, holerites) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.adiantamentoSalarialRun.upsert({
      where: { tenantId_mes_ano: { tenantId, mes, ano } },
      create: {
        tenantId, mes, ano, percent, status: 'CALCULADA', calculadaEm: new Date(),
      },
      update: { percent, status: 'CALCULADA', calculadaEm: new Date() },
    });

    await tx.adiantamentoSalarialHolerite.deleteMany({ where: { runId: run.id } });

    if (holerites?.length) {
      await tx.adiantamentoSalarialHolerite.createMany({
        data: holerites.map((h) => ({
          runId: run.id,
          usuarioId: h.usuarioId,
          percent: h.percent,
          proventos: h.proventos,
          descontos: h.descontos,
          bases: h.bases,
          liquido: h.liquido,
        })),
      });
    }

    return tx.adiantamentoSalarialRun.findUnique({
      where: { id: run.id },
      include: {
        holerites: {
          include: { usuario: { select: { id: true, nome: true, cpf: true, cargo: true } } },
          orderBy: { usuario: { nome: 'asc' } },
        },
      },
    });
  });
}

async function listAdiantamentoRuns(tenantId, { mes, ano } = {}) {
  return prisma.adiantamentoSalarialRun.findMany({
    where: {
      tenantId,
      ...(mes && { mes: Number(mes) }),
      ...(ano && { ano: Number(ano) }),
    },
    include: { _count: { select: { holerites: true } } },
    orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
  });
}

async function findAdiantamentoRun(tenantId, mes, ano) {
  return prisma.adiantamentoSalarialRun.findUnique({
    where: { tenantId_mes_ano: { tenantId, mes, ano } },
    include: {
      holerites: {
        select: { usuarioId: true, liquido: true, percent: true },
      },
    },
  });
}

async function findAdiantamentoRunById(tenantId, runId) {
  return prisma.adiantamentoSalarialRun.findFirst({
    where: { id: runId, tenantId },
    include: {
      holerites: {
        include: { usuario: { select: { id: true, nome: true, cpf: true, cargo: true } } },
        orderBy: { usuario: { nome: 'asc' } },
      },
    },
  });
}

async function findAdiantamentoHolerite(tenantId, holeriteId) {
  return prisma.adiantamentoSalarialHolerite.findFirst({
    where: { id: holeriteId, run: { tenantId } },
    include: {
      usuario: true,
      run: { include: { tenant: { select: { razaoSocial: true, nomeFantasia: true, cnpj: true } } } },
    },
  });
}

module.exports = {
  getOrCreateConfig,
  updateConfig,
  findRun,
  findRunById,
  listRuns,
  upsertRunWithHolerites,
  fecharRun,
  findHolerite,
  listColaboradoresCLT,
  findUsuarioCLT,
  createFeriasPagamento,
  listFeriasPagamentos,
  findFeriasPagamento,
  upsertDecimoRun,
  listDecimoRuns,
  findDecimoRunById,
  findDecimoHolerite,
  createRescisao,
  listRescisoes,
  findRescisao,
  upsertAdiantamentoRun,
  listAdiantamentoRuns,
  findAdiantamentoRun,
  findAdiantamentoRunById,
  findAdiantamentoHolerite,
};
