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
};
