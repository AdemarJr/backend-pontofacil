const {
  montarPorUsuarioEspelho,
  whereRegistrosNoPeriodo,
  SELECT_REGISTRO_ESPELHO,
} = require('../relatorios/espelho.service');
const { fmtHours } = require('../../utils/espelhoCalculo');
const prisma = require('../../infra/prisma');

/**
 * Export AEJ básico (Arquivo Eletrônico de Jornada) — tratamento administrativo de jornada.
 */
async function gerarAejCsv({ tenantId, mes, ano, usuarioId = null }) {
  const mesNum = parseInt(mes, 10);
  const anoNum = parseInt(ano, 10);
  const dataInicio = new Date(anoNum, mesNum - 1, 1);
  const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59);

  const registros = await prisma.registroPonto.findMany({
    where: whereRegistrosNoPeriodo({ tenantId, usuarioId, dataInicio, dataFim }),
    select: SELECT_REGISTRO_ESPELHO,
    orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
  });

  const porUsuario = await montarPorUsuarioEspelho(registros, tenantId, {
    mesNum,
    anoNum,
    usuarioFiltroId: usuarioId,
  });

  const header = [
    'colaborador',
    'cpf_pis',
    'dia',
    'status_dia',
    'horas_trabalhadas',
    'extras_min',
    'deficit_min',
    'banco_horas_acum_min',
  ].join(';');

  const linhas = [header];
  let bancoAcum = 0;

  for (const rel of Object.values(porUsuario)) {
    const doc = rel.usuario?.cpf || rel.usuario?.pis || '';
    const diasMap = rel.diasTrabalhados || {};
    for (const [dia, info] of Object.entries(diasMap)) {
      const minutos = info.minutosTrabalhados || 0;
      const extras = info.extrasMin ?? 0;
      const espMin = info.jornadaContratualMin ?? info.esperado?.cargaHorariaDiaria
        ? Math.round(Number(info.esperado.cargaHorariaDiaria) * 60)
        : 8 * 60;
      const deficit = Math.max(0, espMin - minutos);
      bancoAcum += extras - deficit;
      linhas.push(
        [
          `"${(rel.usuario?.nome || '').replace(/"/g, '""')}"`,
          doc,
          dia,
          info.statusDia || '',
          fmtHours(minutos),
          extras,
          deficit,
          bancoAcum,
        ].join(';')
      );
    }
  }

  const nomeArquivo = `AEJ_${String(mesNum).padStart(2, '0')}_${anoNum}.csv`;
  return { conteudo: linhas.join('\n') + '\n', nomeArquivo };
}

module.exports = { gerarAejCsv };
