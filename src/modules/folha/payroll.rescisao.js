const {
  toNumber,
  rubrica,
  round2,
  valorDiaSalario,
  mesesTrabalhadosNoAno,
  diasTrabalhadosNoMes,
  fecharComImpostos,
} = require('./payroll.shared');
const { calcularSaldoFerias, mesesEntreDatas } = require('./payroll.saldoFerias');

/**
 * Rescisão simplificada CLT: saldo salário, 13º prop., férias + 1/3, aviso prévio (se houver).
 */
async function calcularRescisao({
  tenantId,
  usuario,
  config,
  tipo,
  dataDesligamento,
  avisoPrevioIndenizado = false,
  diasAvisoPrevio = 30,
}) {
  const salario = toNumber(usuario.salarioBase);
  if (!salario || salario <= 0) return { erro: 'Salário base não configurado' };

  const dt = dataDesligamento instanceof Date ? dataDesligamento : new Date(dataDesligamento);
  if (Number.isNaN(dt.getTime())) return { erro: 'Data de desligamento inválida' };

  const mes = dt.getMonth() + 1;
  const ano = dt.getFullYear();
  const vd = valorDiaSalario(salario);
  const proventos = [];
  const descontosPreInss = [];

  const diasMes = diasTrabalhadosNoMes({ ...usuario, dataDemissao: dt }, mes, ano);
  if (diasMes > 0) {
    proventos.push(rubrica('121', 'Saldo de salário', `${diasMes} dia(s)`, round2(vd * diasMes)));
  }

  const mesesAno = mesesTrabalhadosNoAno({ ...usuario, dataDemissao: dt }, ano);
  if (mesesAno > 0) {
    const decimoProp = round2((salario / 12) * mesesAno);
    proventos.push(rubrica('122', '13º salário proporcional', `${mesesAno}/12 avos`, decimoProp));
  }

  const saldoFerias = await calcularSaldoFerias(tenantId, usuario.id, dt);
  const adm = usuario.dataAdmissao ? new Date(usuario.dataAdmissao) : null;
  const mesesVinculo = adm ? mesesEntreDatas(adm, dt) : 0;
  const feriasPropDias = Math.min(30, Math.floor((mesesVinculo % 12) / 12 * 30));
  const feriasVencidasDias = Math.max(0, saldoFerias.saldo);
  const totalFeriasDias = feriasVencidasDias + feriasPropDias;

  if (totalFeriasDias > 0) {
    const brutoF = vd * totalFeriasDias;
    proventos.push(rubrica('123', 'Férias (vencidas + proporcionais)', `${totalFeriasDias} dia(s)`, brutoF));
    proventos.push(rubrica('124', '1/3 constitucional (férias)', '', round2(brutoF / 3)));
  }

  const tipoUp = String(tipo || '').toUpperCase();
  if (tipoUp === 'SEM_JUSTA_CAUSA' && avisoPrevioIndenizado) {
    const dias = Math.max(0, Number(diasAvisoPrevio) || 30);
    proventos.push(rubrica('125', 'Aviso prévio indenizado', `${dias} dia(s)`, round2(vd * dias)));
  }

  if (tipoUp === 'PEDIDO_DEMISSAO') {
    descontosPreInss.push(rubrica('126', 'Desconto aviso prévio não cumprido', 'opcional', 0));
  }

  const fechado = fecharComImpostos({ config, usuario, proventos, descontosPreInss });

  const baseFgtsEst = fechado.bases.inss || proventos.reduce((s, p) => s + p.valor, 0);
  let multaFgtsEstimada = 0;
  if (tipoUp === 'SEM_JUSTA_CAUSA') multaFgtsEstimada = round2(baseFgtsEst * 0.4);
  else if (tipoUp === 'ACORDO') multaFgtsEstimada = round2(baseFgtsEst * 0.2);

  return {
    ...fechado,
    multaFgtsEstimada,
    detalhes: {
      diasSaldoSalario: diasMes,
      mesesDecimo: mesesAno,
      diasFerias: totalFeriasDias,
      saldoFerias,
      tipo: tipoUp,
    },
  };
}

module.exports = { calcularRescisao };
