// src/modules/folha/payroll.irrf.js

function calcularIRRF(base, dependentes, tabelas) {
  const deducaoDep = (dependentes || 0) * tabelas.irrf.deducaoPorDependente;
  const baseCalculo = Math.max(0, base - deducaoDep);

  for (const faixa of tabelas.irrf.faixas) {
    if (faixa.ate === null || baseCalculo <= faixa.ate) {
      const valor = baseCalculo * faixa.aliquota - faixa.deducao;
      return Math.max(0, Math.round(valor * 100) / 100);
    }
  }
  return 0;
}

module.exports = { calcularIRRF };
