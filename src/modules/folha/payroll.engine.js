// src/modules/folha/payroll.engine.js
const { HORAS_MENSAIS_DIVISOR } = require('../../shared/cltJornada');
const tabelas2025 = require('./tabelas/2025.json');
const { calcularINSS } = require('./payroll.inss');
const { calcularIRRF } = require('./payroll.irrf');
const { calcularDSR } = require('./payroll.dsr');

function round2(v) {
  return Math.round(v * 100) / 100;
}

function toNumber(val) {
  if (val == null) return 0;
  return Number(val);
}

function valorHora(salario) {
  return salario / HORAS_MENSAIS_DIVISOR;
}

function rubrica(codigo, descricao, referencia, valor) {
  return { codigo, descricao, referencia, valor: round2(valor) };
}

function salarioProporcional(salario, diasTrabalhados, diasMes) {
  if (!diasMes) return salario;
  return round2((salario / diasMes) * diasTrabalhados);
}

function diasAplicaveisNoMes(dataAdmissao, dataDemissao, mes, ano) {
  const ultimoDia = new Date(ano, mes, 0).getDate();
  let inicio = 1;
  let fim = ultimoDia;
  if (dataAdmissao) {
    const adm = new Date(dataAdmissao);
    if (adm.getFullYear() === ano && adm.getMonth() + 1 === mes) {
      inicio = Math.max(inicio, adm.getDate());
    } else if (adm > new Date(ano, mes - 1, ultimoDia)) {
      return 0;
    }
  }
  if (dataDemissao) {
    const dem = new Date(dataDemissao);
    if (dem.getFullYear() === ano && dem.getMonth() + 1 === mes) {
      fim = Math.min(fim, dem.getDate());
    } else if (dem < new Date(ano, mes - 1, 1)) {
      return 0;
    }
  }
  return Math.max(0, fim - inicio + 1);
}

function getTabelas(config) {
  if (config?.tabelasSnapshot) return config.tabelasSnapshot;
  return tabelas2025;
}

/**
 * @param {object} config FolhaConfig
 * @param {object} espelhoItem item do espelho por colaborador
 * @param {object} usuario dados do colaborador
 */
function calcularHolerite(config, espelhoItem, usuario) {
  const tabelas = getTabelas(config);
  const salario = toNumber(usuario.salarioBase);
  const mes = espelhoItem.periodoMes;
  const ano = espelhoItem.periodoAno;

  if (!salario || salario <= 0) {
    return {
      erro: 'Salário base não configurado',
      proventos: [],
      descontos: [],
      bases: {},
      liquido: 0,
    };
  }

  const diasMes = new Date(ano, mes, 0).getDate();
  const diasAplicaveis = diasAplicaveisNoMes(usuario.dataAdmissao, usuario.dataDemissao, mes, ano);
  const resumo = espelhoItem.resumo || {};
  const vHora = valorHora(salario);

  const proventos = [];
  const descontos = [];

  const salarioBase = salarioProporcional(salario, diasAplicaveis, diasMes);
  proventos.push(rubrica('001', 'Salário base', `${diasAplicaveis}/${diasMes} dias`, salarioBase));

  let heDiaUtilMin = espelhoItem.heDiaUtilMin || 0;
  let heDomingoMin = espelhoItem.heDomingoFeriadoMin || 0;
  const deficitMin = espelhoItem.deficitMesMin || 0;

  if (config.modoBancoHoras === 'COMPENSAR' && deficitMin > 0) {
    const reduzir = Math.min(deficitMin, heDiaUtilMin + heDomingoMin);
    if (heDiaUtilMin >= reduzir) heDiaUtilMin -= reduzir;
    else {
      const resto = reduzir - heDiaUtilMin;
      heDiaUtilMin = 0;
      heDomingoMin = Math.max(0, heDomingoMin - resto);
    }
  } else if (config.modoBancoHoras === 'PAGAR' && deficitMin > 0) {
    const horasDeficit = deficitMin / 60;
    descontos.push(rubrica('201', 'Desconto banco de horas', `${horasDeficit.toFixed(2)}h`, round2(horasDeficit * vHora)));
  }

  const pctUtil = 1 + (config.heDiaUtilPercent || 50) / 100;
  const pctDom = 1 + (config.heDomingoFeriadoPercent || 100) / 100;

  if (heDiaUtilMin > 0) {
    const horas = heDiaUtilMin / 60;
    proventos.push(rubrica('002', `Hora extra ${config.heDiaUtilPercent || 50}%`, `${horas.toFixed(2)}h`, round2(horas * vHora * pctUtil)));
  }
  if (heDomingoMin > 0) {
    const horas = heDomingoMin / 60;
    proventos.push(rubrica('003', `Hora extra ${config.heDomingoFeriadoPercent || 100}%`, `${horas.toFixed(2)}h`, round2(horas * vHora * pctDom)));
  }

  const minNoturnos = espelhoItem.minutosNoturnos || 0;
  if (minNoturnos > 0) {
    const horas = minNoturnos / 60;
    const pctNot = (config.adicionalNoturnoPercent || 20) / 100;
    proventos.push(rubrica('004', `Adicional noturno ${config.adicionalNoturnoPercent || 20}%`, `${horas.toFixed(2)}h`, round2(horas * vHora * pctNot)));
  }

  const totalHEMin = heDiaUtilMin + heDomingoMin;
  if (config.pagarDSR !== false && totalHEMin > 0) {
    const dsrValor = calcularDSR({
      totalHEMin,
      diasUteis: resumo.diasUteis || 1,
      domingosEFeriados: resumo.domingosEFeriados || 0,
      valorHora: vHora * pctUtil,
    });
    if (dsrValor > 0) {
      proventos.push(rubrica('005', 'DSR sobre horas extras', '', dsrValor));
    }
  }

  const faltas = resumo.faltas || 0;
  if (faltas > 0 && config.modoBancoHoras !== 'COMPENSAR') {
    descontos.push(rubrica('202', 'Faltas não justificadas', `${faltas} dia(s)`, round2((salario / 30) * faltas)));
  }

  const totalProventos = proventos.reduce((s, p) => s + p.valor, 0);
  const totalDescontosPre = descontos.reduce((s, d) => s + d.valor, 0);
  const baseINSS = Math.max(0, totalProventos - totalDescontosPre);

  const inss = calcularINSS(baseINSS, tabelas);
  if (inss > 0) descontos.push(rubrica('301', 'INSS', `${(tabelas.versao || '2025')}`, inss));

  const baseIRRF = Math.max(0, baseINSS - inss);
  const irrf = calcularIRRF(baseIRRF, usuario.dependentesIrrf || 0, tabelas);
  if (irrf > 0) descontos.push(rubrica('302', 'IRRF', '', irrf));

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

function validarPendencias(espelhoItem, config) {
  const pendencias = [];
  if (!config.permitirFolhaSemAssinatura) {
    const fech = espelhoItem.fechamento;
    if (!fech || fech.status !== 'ASSINADO') {
      pendencias.push({
        tipo: 'ESPELHO_NAO_ASSINADO',
        usuarioId: espelhoItem.usuario?.id,
        nome: espelhoItem.usuario?.nome,
      });
    }
  }
  if (!espelhoItem.usuario?.salarioBase || toNumber(espelhoItem.usuario.salarioBase) <= 0) {
    pendencias.push({
      tipo: 'SALARIO_NAO_CONFIGURADO',
      usuarioId: espelhoItem.usuario?.id,
      nome: espelhoItem.usuario?.nome,
    });
  }
  return pendencias;
}

module.exports = {
  calcularHolerite,
  validarPendencias,
  getTabelas,
  tabelas2025,
};
