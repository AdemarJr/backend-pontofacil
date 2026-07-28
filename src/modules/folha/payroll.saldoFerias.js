const prisma = require('../../infra/prisma');
const { diasEntreISO } = require('./payroll.shared');

function mesesEntreDatas(inicio, fim) {
  const a = new Date(inicio);
  const b = new Date(fim);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
    + (b.getDate() >= a.getDate() ? 0 : -1);
}

/**
 * Saldo simplificado CLT: 30 dias a cada 12 meses de vínculo.
 */
async function calcularSaldoFerias(tenantId, usuarioId, refDate = new Date()) {
  const usuario = await prisma.usuario.findFirst({
    where: { id: usuarioId, tenantId },
    select: { dataAdmissao: true, dataDemissao: true },
  });
  if (!usuario?.dataAdmissao) {
    return { direitoTotal: 0, diasUsados: 0, saldo: 0, mesesVinculo: 0 };
  }

  const adm = new Date(usuario.dataAdmissao);
  const fim = usuario.dataDemissao && new Date(usuario.dataDemissao) < refDate
    ? new Date(usuario.dataDemissao)
    : refDate;
  if (fim <= adm) {
    return { direitoTotal: 0, diasUsados: 0, saldo: 0, mesesVinculo: 0 };
  }

  const mesesVinculo = mesesEntreDatas(adm, fim);
  const direitoTotal = Math.floor(mesesVinculo / 12) * 30;

  const [feriasAprovadas, pagamentos] = await Promise.all([
    prisma.ferias.findMany({
      where: { tenantId, usuarioId, status: 'APROVADA' },
      select: { dataInicio: true, dataFim: true },
    }),
    prisma.feriasPagamento.findMany({
      where: { tenantId, usuarioId },
      select: { diasFerias: true, diasAbono: true },
    }),
  ]);

  let diasUsados = 0;
  for (const f of feriasAprovadas) {
    diasUsados += diasEntreISO(f.dataInicio, f.dataFim);
  }
  for (const p of pagamentos) {
    diasUsados += (p.diasFerias || 0) + (p.diasAbono || 0);
  }

  const saldo = Math.max(0, direitoTotal - diasUsados);
  return { direitoTotal, diasUsados, saldo, mesesVinculo };
}

module.exports = { calcularSaldoFerias, mesesEntreDatas };
