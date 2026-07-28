// src/modules/folha/payroll.beneficios.js

function round2(v) {
  return Math.round(v * 100) / 100;
}

function toNumber(val) {
  if (val == null) return 0;
  return Number(val);
}

function rubrica(codigo, descricao, referencia, valor) {
  return { codigo, descricao, referencia, valor: round2(valor) };
}

function valorDiaSalario(salario) {
  return round2(salario / 30);
}

/**
 * VT: desconto = min(custo mensal, teto % salário), opcionalmente proporcional às faltas.
 */
function calcularDescontoVt({ usuario, config, salario, resumo }) {
  if (!usuario?.usaVt) return null;
  const custo = toNumber(usuario.valorVtMensal);
  if (custo <= 0) return null;

  const pctMax = Math.min(6, Math.max(0, config?.vtPercentMax ?? 6));
  const teto = round2((salario * pctMax) / 100);
  let valor = round2(Math.min(custo, teto));

  const diasUteis = resumo?.diasUteis || 0;
  const faltas = resumo?.faltas || 0;
  if (config?.vtProporcionalFaltas !== false && diasUteis > 0 && faltas > 0) {
    const fator = Math.max(0, (diasUteis - faltas) / diasUteis);
    valor = round2(valor * fator);
  }

  if (valor <= 0) return null;
  return rubrica('401', 'Vale transporte', `teto ${pctMax}%`, valor);
}

function calcularDescontoVa(usuario) {
  const v = toNumber(usuario?.descontoVaMensal);
  if (v <= 0) return null;
  return rubrica('402', 'Vale alimentação/refeição', 'mensal', v);
}

function calcularDescontoPlanoSaude(usuario) {
  const v = toNumber(usuario?.descontoPlanoSaudeMensal);
  if (v <= 0) return null;
  return rubrica('403', 'Plano de saúde', 'coparticipação', v);
}

function calcularDescontoAtrasos({ config, salario, resumo }) {
  if (!config?.descontarAtrasos) return null;
  const dias = resumo?.diasAtraso || 0;
  if (dias <= 0) return null;
  const pct = Math.max(0, Math.min(100, config.descontoAtrasoDiarioPercent ?? 25));
  const valor = round2(valorDiaSalario(salario) * dias * (pct / 100));
  if (valor <= 0) return null;
  return rubrica('203', 'Desconto por atrasos', `${dias} dia(s) × ${pct}% dia`, valor);
}

function calcularDescontoIntervalo({ config, salario, resumo }) {
  if (!config?.descontarIntervaloInsuficiente) return null;
  const dias = resumo?.diasIntervaloInsuficiente || 0;
  if (dias <= 0) return null;
  const pct = Math.max(0, Math.min(100, config.descontoIntervaloDiarioPercent ?? 25));
  const valor = round2(valorDiaSalario(salario) * dias * (pct / 100));
  if (valor <= 0) return null;
  return rubrica('204', 'Intervalo insuficiente', `${dias} dia(s) × ${pct}% dia`, valor);
}

function aplicarBeneficiosEDescontosPonto({ config, usuario, salario, resumo, descontosPreInss, descontosPosInss }) {
  const pre = [...descontosPreInss];
  const pos = [...descontosPosInss];

  const atraso = calcularDescontoAtrasos({ config, salario, resumo });
  if (atraso) pre.push(atraso);

  const intervalo = calcularDescontoIntervalo({ config, salario, resumo });
  if (intervalo) pre.push(intervalo);

  const vt = calcularDescontoVt({ config, usuario, salario, resumo });
  if (vt) pos.push(vt);

  const va = calcularDescontoVa(usuario);
  if (va) pos.push(va);

  const saude = calcularDescontoPlanoSaude(usuario);
  if (saude) pos.push(saude);

  return { descontosPreInss: pre, descontosPosInss: pos };
}

module.exports = {
  calcularDescontoVt,
  calcularDescontoVa,
  calcularDescontoPlanoSaude,
  calcularDescontoAtrasos,
  calcularDescontoIntervalo,
  aplicarBeneficiosEDescontosPonto,
};
