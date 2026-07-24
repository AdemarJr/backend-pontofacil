const prisma = require('../../infra/prisma');
const { documentoParaExport, apenasDigitos } = require('../../shared/documentoIdentificacao');

function padN(val, len) {
  return String(val ?? '').slice(0, len).padStart(len, '0');
}

function fmtAfdDate(d) {
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}${pad(dt.getMonth() + 1)}${dt.getFullYear()}`;
}

function fmtAfdTime(d) {
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getHours())}${pad(dt.getMinutes())}`;
}

function tipoAfdCodigo(tipo) {
  const map = {
    ENTRADA: 'E',
    SAIDA: 'S',
    SAIDA_ALMOCO: 'I',
    RETORNO_ALMOCO: 'R',
  };
  return map[tipo] || 'O';
}

/**
 * Export pré-AFD administrativo (não substitui AFD certificado ICP-Brasil).
 */
async function gerarPreAfdTxt({ tenantId, dataInicio, dataFim }) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { cnpj: true, razaoSocial: true, nomeFantasia: true },
  });
  if (!tenant) throw new Error('Tenant não encontrado');

  const inicio = new Date(dataInicio + 'T00:00:00');
  const fim = new Date(dataFim + 'T23:59:59.999');

  const registros = await prisma.registroPonto.findMany({
    where: {
      tenantId,
      dataHora: { gte: inicio, lte: fim },
    },
    include: {
      usuario: { select: { nome: true, cpf: true, pis: true } },
      ajuste: true,
    },
    orderBy: [{ nsr: 'asc' }, { dataHora: 'asc' }],
  });

  const cnpj = padN(apenasDigitos(tenant.cnpj), 14);
  const linhas = [];

  // Tipo 1 — cabeçalho empregador (simplificado)
  linhas.push(
    `1${cnpj}${padN('', 14)}${fmtAfdDate(inicio)}${fmtAfdDate(fim)}${String(tenant.razaoSocial || tenant.nomeFantasia).slice(0, 150).padEnd(150)}`
  );

  for (const r of registros) {
    const doc = padN(documentoParaExport(r.usuario), 12);
    const nsr = padN(r.nsr ?? 0, 9);
    const excluido = r.deletedAt ? 'X' : ' ';
    const ajustado = r.ajuste ? 'A' : ' ';
    // Tipo 3 — marcação
    linhas.push(
      `3${nsr}${fmtAfdDate(r.dataHora)}${fmtAfdTime(r.dataHora)}${doc}${tipoAfdCodigo(r.tipo)}${excluido}${ajustado}`
    );
    if (r.deletedAt) {
      linhas.push(
        `9${nsr}OBS EXCLUIDO ${fmtAfdDate(r.deletedAt)} ${String(r.deletedMotivo || '').slice(0, 80).padEnd(80)}`
      );
    }
    if (r.ajuste && r.ajuste.dataHoraNova.getTime() !== r.ajuste.dataHoraOriginal.getTime()) {
      linhas.push(
        `9${nsr}OBS AJUSTE ${fmtAfdDate(r.ajuste.dataHoraNova)} ${fmtAfdTime(r.ajuste.dataHoraNova)} ${String(r.ajuste.motivo || '').slice(0, 60).padEnd(60)}`
      );
    }
  }

  linhas.push(`999999999EXPORTACAO_ADMINISTRATIVA_PRE_AFD${' '.repeat(60)}`);

  const nomeArquivo = `AFD${cnpj}REP_P_PRE.txt`;
  return { conteudo: linhas.join('\r\n') + '\r\n', nomeArquivo };
}

module.exports = { gerarPreAfdTxt };
