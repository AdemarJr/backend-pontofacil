const { toNumber, rubrica, valorDiaSalario, fecharComImpostos } = require('./payroll.shared');

/**
 * Férias CLT: salário + 1/3 constitucional; abono pecuniário (até 10 dias) idem.
 * Adiantamento de 1/3 descontado quando configurado.
 */
function calcularPagamentoFerias({ config, usuario, diasFerias, diasAbono = 0, adiantamentoUmTerco = true }) {
  const salario = toNumber(usuario.salarioBase);
  if (!salario || salario <= 0) {
    return { erro: 'Salário base não configurado' };
  }

  const diasF = Math.max(0, Math.min(30, Number(diasFerias) || 0));
  const diasA = Math.max(0, Math.min(10, Number(diasAbono) || 0));
  if (diasF <= 0) return { erro: 'Informe os dias de férias' };

  const vd = valorDiaSalario(salario);
  const brutoFerias = vd * diasF;
  const tercoFerias = brutoFerias / 3;
  const brutoAbono = vd * diasA;
  const tercoAbono = brutoAbono / 3;

  const proventos = [
    rubrica('101', 'Férias', `${diasF} dia(s)`, brutoFerias),
    rubrica('102', '1/3 constitucional (férias)', '', tercoFerias),
  ];
  if (diasA > 0) {
    proventos.push(rubrica('103', 'Abono pecuniário', `${diasA} dia(s)`, brutoAbono));
    proventos.push(rubrica('104', '1/3 constitucional (abono)', '', tercoAbono));
  }

  const descontosPreInss = [];
  if (adiantamentoUmTerco !== false) {
    const adiant = tercoFerias + (diasA > 0 ? tercoAbono : 0);
    if (adiant > 0) {
      descontosPreInss.push(rubrica('105', 'Adiantamento 1/3 férias', '', adiant));
    }
  }

  return fecharComImpostos({ config, usuario, proventos, descontosPreInss });
}

module.exports = { calcularPagamentoFerias };
