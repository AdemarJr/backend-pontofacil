// src/modules/folha/payroll.inss.js

function calcularINSS(base, tabelas) {
  const faixas = tabelas.inss.faixas;
  const teto = tabelas.inss.teto;
  const baseLimitada = Math.min(Math.max(0, base), teto);

  let restante = baseLimitada;
  let anterior = 0;
  let total = 0;

  for (const faixa of faixas) {
    const limite = faixa.ate;
    const parcela = Math.min(restante, limite - anterior);
    if (parcela <= 0) break;
    total += parcela * faixa.aliquota;
    restante -= parcela;
    anterior = limite;
    if (restante <= 0) break;
  }

  return Math.round(total * 100) / 100;
}

module.exports = { calcularINSS };
