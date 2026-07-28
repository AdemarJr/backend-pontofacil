const { calcularINSS } = require('./payroll.inss');
const { calcularIRRF } = require('./payroll.irrf');
const tabelas2025 = require('./tabelas/2025.json');
const { getTabelas } = require('./payroll.engine');

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

function diasEntreISO(inicio, fim) {
  const a = new Date(`${inicio}T12:00:00`);
  const b = new Date(`${fim}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b - a) / 86400000) + 1);
}

function mesesTrabalhadosNoAno(usuario, ano) {
  const adm = usuario.dataAdmissao ? new Date(usuario.dataAdmissao) : null;
  const dem = usuario.dataDemissao ? new Date(usuario.dataDemissao) : null;
  let inicio = new Date(ano, 0, 1);
  let fim = new Date(ano, 11, 31, 23, 59, 59);
  if (adm && adm > inicio) inicio = adm;
  if (dem && dem < fim) fim = dem;
  if (fim < inicio) return 0;
  const mesInicio = inicio.getFullYear() === ano ? inicio.getMonth() : 0;
  const mesFim = fim.getFullYear() === ano ? fim.getMonth() : 11;
  let meses = mesFim - mesInicio + 1;
  if (inicio.getDate() > 15 && inicio.getFullYear() === ano) meses -= 0.5;
  if (fim.getDate() < 15 && fim.getFullYear() === ano) meses -= 0.5;
  return Math.max(0, Math.min(12, Math.round(meses * 2) / 2));
}

function diasTrabalhadosNoMes(usuario, mes, ano) {
  const ultimo = new Date(ano, mes, 0).getDate();
  let inicio = 1;
  let fim = ultimo;
  if (usuario.dataAdmissao) {
    const adm = new Date(usuario.dataAdmissao);
    if (adm.getFullYear() === ano && adm.getMonth() + 1 === mes) inicio = Math.max(inicio, adm.getDate());
    else if (adm > new Date(ano, mes - 1, ultimo)) return 0;
  }
  if (usuario.dataDemissao) {
    const dem = new Date(usuario.dataDemissao);
    if (dem.getFullYear() === ano && dem.getMonth() + 1 === mes) fim = Math.min(fim, dem.getDate());
    else if (dem < new Date(ano, mes - 1, 1)) return 0;
  }
  return Math.max(0, fim - inicio + 1);
}

function fecharComImpostos({ config, usuario, proventos, descontosPreInss = [], descontosPosInss = [] }) {
  const tabelas = getTabelas(config);
  const totalProventos = proventos.reduce((s, p) => s + p.valor, 0);
  const totalPre = descontosPreInss.reduce((s, d) => s + d.valor, 0);
  const baseINSS = Math.max(0, totalProventos - totalPre);
  const descontos = [...descontosPreInss];
  const inss = calcularINSS(baseINSS, tabelas);
  if (inss > 0) descontos.push(rubrica('301', 'INSS', `${tabelas.versao || '2025'}`, inss));
  const baseIRRF = Math.max(0, baseINSS - inss);
  const irrf = calcularIRRF(baseIRRF, usuario.dependentesIrrf || 0, tabelas);
  if (irrf > 0) descontos.push(rubrica('302', 'IRRF', '', irrf));
  descontos.push(...descontosPosInss);
  const fgts = round2(baseINSS * (tabelas.fgts?.aliquota || 0.08));
  const liquido = round2(totalProventos - descontos.reduce((s, d) => s + d.valor, 0));
  return {
    proventos,
    descontos,
    bases: { inss: baseINSS, irrf: baseIRRF, fgts },
    liquido,
    tabelasVersao: tabelas.versao || '2025',
  };
}

module.exports = {
  round2,
  toNumber,
  rubrica,
  valorDiaSalario,
  diasEntreISO,
  mesesTrabalhadosNoAno,
  diasTrabalhadosNoMes,
  fecharComImpostos,
  tabelas2025,
};
