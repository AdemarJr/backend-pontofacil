const { toNumber, rubrica, round2, mesesTrabalhadosNoAno, fecharComImpostos } = require('./payroll.shared');

/**
 * 13º: 1ª parcela 50% sem INSS; 2ª parcela saldo com INSS/IRRF sobre total anual (simplificado).
 */
function calcularDecimoTerceiro({ config, usuario, ano, parcela, mesesOverride }) {
  const salario = toNumber(usuario.salarioBase);
  if (!salario || salario <= 0) return { erro: 'Salário base não configurado' };

  const p = Number(parcela);
  if (p !== 1 && p !== 2) return { erro: 'Parcela deve ser 1 ou 2' };

  const meses = mesesOverride != null
    ? Number(mesesOverride)
    : mesesTrabalhadosNoAno(usuario, Number(ano));
  if (meses <= 0) return { erro: 'Sem meses trabalhados no ano' };

  const decimoIntegral = round2((salario / 12) * meses);

  if (p === 1) {
    const valor = round2(decimoIntegral * 0.5);
    return {
      proventos: [rubrica('111', '13º salário — 1ª parcela', `${meses}/12 avos`, valor)],
      descontos: [],
      bases: { inss: 0, irrf: 0, fgts: 0 },
      liquido: valor,
      mesesTrabalhados: meses,
      decimoIntegral,
    };
  }

  const primeira = round2(decimoIntegral * 0.5);
  const segundaBruta = round2(decimoIntegral - primeira);
  const proventos = [rubrica('112', '13º salário — 2ª parcela', `${meses}/12 avos`, segundaBruta)];

  const impostos = fecharComImpostos({
    config,
    usuario,
    proventos: [rubrica('110', '13º salário (base anual)', `${meses}/12 avos`, decimoIntegral)],
    descontosPreInss: [],
  });

  const inssSegunda = impostos.descontos.find((d) => d.codigo === '301')?.valor || 0;
  const irrfSegunda = impostos.descontos.find((d) => d.codigo === '302')?.valor || 0;
  const descontos = [];
  if (inssSegunda > 0) descontos.push(rubrica('301', 'INSS (13º)', '', inssSegunda));
  if (irrfSegunda > 0) descontos.push(rubrica('302', 'IRRF (13º)', '', irrfSegunda));

  const liquido = round2(segundaBruta - inssSegunda - irrfSegunda);

  return {
    proventos,
    descontos,
    bases: impostos.bases,
    liquido,
    mesesTrabalhados: meses,
    decimoIntegral,
  };
}

module.exports = { calcularDecimoTerceiro };
