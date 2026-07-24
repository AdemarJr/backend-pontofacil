// src/modules/relatorios/espelho.service.js
const {
  calcularDia,
  escalaParaDia,
  fmtHours,
  fmtTime,
  pad2,
} = require('../../utils/espelhoCalculo');
const {
  cltOptsFromTenant,
  horasNormaisDiaMin,
  semanaISOKey,
  calcularHeSemanal,
} = require('../../shared/cltJornada');
const prisma = require('../../infra/prisma');

const SELECT_REGISTRO_ESPELHO = {
  id: true,
  tenantId: true,
  usuarioId: true,
  tipo: true,
  dataHora: true,
  origem: true,
  validado: true,
  fotoKey: true,
  usuario: { select: { id: true, nome: true, cargo: true, departamento: true } },
  ajuste: true,
};

const FOLGA_TIPO_ARQUIVO = 'FOLGA';
const TIPOS_MARCADOR_MANUAL = ['FOLGA', 'JUSTIFICATIVA'];

const STATUS_DIA = {
  TRABALHADO: 'TRABALHADO',
  PARCIAL: 'PARCIAL',
  FALTA: 'FALTA',
  FOLGA: 'FOLGA',
  FERIAS: 'FERIAS',
  FERIADO: 'FERIADO',
  JUSTIFICADA: 'JUSTIFICADA',
  ANTES_ADMISSAO: 'ANTES_ADMISSAO',
  POS_DEMISSAO: 'POS_DEMISSAO',
  EM_ABERTO: 'EM_ABERTO',
  FUTURO: 'FUTURO',
};

const STATUS_DIA_LABEL = {
  TRABALHADO: 'Trabalhado',
  PARCIAL: 'Parcial (falta marcação)',
  FALTA: 'Falta',
  FOLGA: 'Folga',
  FERIAS: 'Férias',
  FERIADO: 'Feriado',
  JUSTIFICADA: 'Falta justificada',
  ANTES_ADMISSAO: 'Antes da admissão',
  POS_DEMISSAO: 'Após demissão',
  EM_ABERTO: 'Em aberto (hoje)',
  FUTURO: 'A cumprir',
};

function fmtDateISO(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function diasDoMesISO(mesNum, anoNum) {
  const last = new Date(anoNum, mesNum, 0).getDate();
  const dias = [];
  for (let d = 1; d <= last; d++) {
    dias.push(`${anoNum}-${pad2(mesNum)}-${pad2(d)}`);
  }
  return dias;
}

function whereRegistrosNoPeriodo({ tenantId, usuarioId, dataInicio, dataFim }) {
  return {
    tenantId,
    deletedAt: null,
    ...(usuarioId && { usuarioId }),
    OR: [
      {
        ajuste: { is: null },
        dataHora: { gte: dataInicio, lte: dataFim },
      },
      {
        ajuste: { is: { dataHoraNova: { gte: dataInicio, lte: dataFim } } },
      },
    ],
  };
}

async function montarPorUsuarioEspelho(registros, tenantId, { mesNum, anoNum, usuarioFiltroId }) {
  function origemDoTipoEm(pontos, tipo, dt) {
    if (!dt) return '';
    const t = new Date(dt).getTime();
    const achado = pontos.find((p) => p.tipo === tipo && new Date(p.dataHora).getTime() === t);
    return achado?.origem || '';
  }

  const diasMes = diasDoMesISO(mesNum, anoNum);
  const primeiroDia = diasMes[0];
  const ultimoDia = diasMes[diasMes.length - 1];

  const [tenant, colaboradores] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        toleranciaMinutos: true,
        intervaloMinimoAlmocoMinutos: true,
        modoMarcacao: true,
      },
    }),
    prisma.usuario.findMany({
      where: {
        tenantId,
        role: 'COLABORADOR',
        ativo: true,
        ...(usuarioFiltroId ? { id: String(usuarioFiltroId) } : {}),
      },
      select: {
        id: true, nome: true, cargo: true, departamento: true,
        dataAdmissao: true, dataDemissao: true,
        tipoContrato: true, salarioBase: true, cpf: true, pis: true,
        dependentesIrrf: true,
      },
      orderBy: { nome: 'asc' },
    }),
  ]);
  const tol = tenant?.toleranciaMinutos ?? 5;
  const clt = cltOptsFromTenant(tenant);
  const modoMarcacao = tenant?.modoMarcacao || 'QUATRO_BATIDAS';

  if (colaboradores.length === 0) return {};

  const uids = colaboradores.map((u) => u.id);
  const uidSet = new Set(uids);
  const metaPorUsuario = Object.fromEntries(
    colaboradores.map((u) => [u.id, { dataAdmissao: u.dataAdmissao, dataDemissao: u.dataDemissao }])
  );

  const [feriados, ferias, escalasAll, comprovantes] = await Promise.all([
    prisma.feriado.findMany({
      where: { tenantId, data: { gte: primeiroDia, lte: ultimoDia } },
      select: { data: true, nome: true, suspendeExpediente: true },
    }),
    prisma.ferias.findMany({
      where: {
        tenantId,
        usuarioId: { in: uids },
        status: 'APROVADA',
        AND: [{ dataInicio: { lte: ultimoDia } }, { dataFim: { gte: primeiroDia } }],
      },
      select: { usuarioId: true, dataInicio: true, dataFim: true, observacao: true },
    }),
    prisma.escala.findMany({
      where: { tenantId, usuarioId: { in: uids }, ativo: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.comprovanteAusencia.findMany({
      where: {
        tenantId,
        usuarioId: { in: uids },
        status: 'APROVADO',
        dataReferencia: { lte: ultimoDia },
        OR: [{ dataFim: null }, { dataFim: { gte: primeiroDia } }],
      },
      select: {
        id: true, usuarioId: true, dataReferencia: true, dataFim: true,
        descricao: true, tipoArquivo: true, arquivoKey: true, arquivoUrl: true,
      },
    }),
  ]);

  const feriadoPorDia = Object.fromEntries(feriados.map((f) => [f.data, f]));
  const feriasPorUsuario = {};
  for (const f of ferias) {
    if (!feriasPorUsuario[f.usuarioId]) feriasPorUsuario[f.usuarioId] = [];
    feriasPorUsuario[f.usuarioId].push(f);
  }
  const escalasPorUsuario = {};
  for (const e of escalasAll) {
    if (!escalasPorUsuario[e.usuarioId]) escalasPorUsuario[e.usuarioId] = [];
    escalasPorUsuario[e.usuarioId].push(e);
  }
  const comprovantesPorUsuario = {};
  for (const c of comprovantes) {
    if (!comprovantesPorUsuario[c.usuarioId]) comprovantesPorUsuario[c.usuarioId] = [];
    comprovantesPorUsuario[c.usuarioId].push(c);
  }
  const comprovanteNoDia = (lista, dia) =>
    (lista || []).find((c) => {
      const ini = c.dataReferencia;
      const fim = c.dataFim || c.dataReferencia;
      return ini <= dia && fim >= dia;
    }) || null;

  const hojeISO = fmtDateISO(new Date());
  const pontosPorUsuarioDia = {};
  for (const r of registros) {
    const uid = r.usuarioId;
    if (!uidSet.has(uid)) continue;
    const dia = fmtDateISO(r.ajuste ? r.ajuste.dataHoraNova : r.dataHora);
    if (!pontosPorUsuarioDia[uid]) pontosPorUsuarioDia[uid] = {};
    if (!pontosPorUsuarioDia[uid][dia]) pontosPorUsuarioDia[uid][dia] = [];
    pontosPorUsuarioDia[uid][dia].push({
      id: r.id,
      tipo: r.tipo,
      dataHora: r.ajuste ? r.ajuste.dataHoraNova : r.dataHora,
      fotoUrl: null,
      origem: r.origem,
      ajustado: !!r.ajuste,
      motivoAjuste: r.ajuste?.motivo,
    });
  }

  const porUsuario = {};
  for (const u of colaboradores) {
    porUsuario[u.id] = {
      usuario: {
        id: u.id, nome: u.nome, cargo: u.cargo, departamento: u.departamento,
        tipoContrato: u.tipoContrato, salarioBase: u.salarioBase, cpf: u.cpf,
        dependentesIrrf: u.dependentesIrrf,
      },
      diasTrabalhados: {},
      totalHoras: '00:00',
      totalExtras: '00:00',
      totalTrabalhadoMin: 0,
      totalEsperadoMin: 0,
      saldoMesMin: 0,
      horaExtraMesMin: 0,
      deficitMesMin: 0,
      horaExtraMes: '00:00',
      saldoMes: '00:00',
      heDiaUtilMin: 0,
      heDomingoFeriadoMin: 0,
      heSemanalMin: 0,
      minutosNoturnos: 0,
      clt: clt.ativo ? { ativo: true, violacoes: { intervalo: 0, jornada8h: 0, semanal44h: 0 } } : { ativo: false },
      resumo: {
        diasUteis: 0,
        trabalhados: 0,
        parciais: 0,
        faltas: 0,
        folgas: 0,
        justificadas: 0,
        feriados: 0,
        ferias: 0,
        emAberto: 0,
        futuros: 0,
        domingosEFeriados: 0,
      },
    };
  }

  for (const uid of uids) {
    let totalMinutos = 0;
    let totalExtras = 0;
    let totalEsperadoMin = 0;
    let heDiaUtilMin = 0;
    let heDomingoFeriadoMin = 0;
    let minutosNoturnos = 0;
    const normaisPorSemana = {};
    let violacoesIntervalo = 0;
    let violacoesJornada8h = 0;
    const listaEsc = escalasPorUsuario[uid] || [];
    const temEscala = listaEsc.length > 0;
    const meta = metaPorUsuario[uid] || {};
    const feriasU = feriasPorUsuario[uid] || [];
    const comprovantesU = comprovantesPorUsuario[uid] || [];
    const resumo = porUsuario[uid].resumo;

    for (const dia of diasMes) {
      const pontos = (pontosPorUsuarioDia[uid] && pontosPorUsuarioDia[uid][dia]) || [];
      const escalaDia = escalaParaDia(listaEsc, dia);
      const calc = calcularDia(pontos, {
        escala: escalaDia || undefined,
        toleranciaMinutos: tol,
        dataRef: dia,
        clt: clt.ativo ? clt : null,
        modoMarcacao,
      });
      const minutos = calc.minutosTrabalhados;

      const feriado = feriadoPorDia[dia];
      const feriasNoDia = feriasU.find((f) => f.dataInicio <= dia && f.dataFim >= dia) || null;
      const comprovante = comprovanteNoDia(comprovantesU, dia);
      const ehFolgaComprovante = comprovante?.tipoArquivo === FOLGA_TIPO_ARQUIVO;
      const ehMarcadorManual =
        !!comprovante &&
        TIPOS_MARCADOR_MANUAL.includes(comprovante.tipoArquivo) &&
        !comprovante.arquivoKey &&
        !comprovante.arquivoUrl;
      const admissaoOk = meta?.dataAdmissao ? fmtDateISO(meta.dataAdmissao) <= dia : true;
      const naoDemitidoNoDia = meta?.dataDemissao ? fmtDateISO(meta.dataDemissao) >= dia : true;

      const dow = new Date(dia + 'T12:00:00').getDay();
      const ehDomingo = dow === 0;
      const ehFeriadoSuspende = feriado?.suspendeExpediente === true;

      const ehDiaUtilProgramado = temEscala
        ? escalaDia != null
        : dow >= 1 && dow <= 5;

      const ehFuturo = dia > hojeISO;
      const ehHoje = dia === hojeISO;
      const temAlgumPonto = pontos.length > 0;

      let statusDia;
      if (!admissaoOk) statusDia = STATUS_DIA.ANTES_ADMISSAO;
      else if (!naoDemitidoNoDia) statusDia = STATUS_DIA.POS_DEMISSAO;
      else if (ehFeriadoSuspende) statusDia = STATUS_DIA.FERIADO;
      else if (feriasNoDia) statusDia = STATUS_DIA.FERIAS;
      else if (comprovante) statusDia = ehFolgaComprovante ? STATUS_DIA.FOLGA : STATUS_DIA.JUSTIFICADA;
      else if (!ehDiaUtilProgramado) statusDia = STATUS_DIA.FOLGA;
      else if (temAlgumPonto) statusDia = calc.flags.faltandoMarcacao ? STATUS_DIA.PARCIAL : STATUS_DIA.TRABALHADO;
      else if (ehFuturo) statusDia = STATUS_DIA.FUTURO;
      else if (ehHoje) statusDia = STATUS_DIA.EM_ABERTO;
      else statusDia = STATUS_DIA.FALTA;

      const diaExigeJornada =
        statusDia === STATUS_DIA.TRABALHADO ||
        statusDia === STATUS_DIA.PARCIAL ||
        statusDia === STATUS_DIA.FALTA ||
        statusDia === STATUS_DIA.EM_ABERTO;

      const espMinBase = escalaDia ? Math.round(Number(escalaDia.cargaHorariaDiaria) * 60) : 8 * 60;
      const espMin = diaExigeJornada ? espMinBase : 0;
      const esperadoZero = espMin === 0;
      totalEsperadoMin += espMin;

      let flags = calc.flags;
      let extrasMinDia = clt.ativo ? calc.extrasEfetivoMin : calc.extrasMin;
      if (esperadoZero) {
        flags = { ...flags, faltandoMarcacao: false };
        extrasMinDia = Math.max(0, minutos);
      }

      if (clt.ativo && diaExigeJornada && minutos > 0) {
        const wk = semanaISOKey(dia);
        const normais = horasNormaisDiaMin(minutos, clt.limiteDiarioMin);
        normaisPorSemana[wk] = (normaisPorSemana[wk] || 0) + normais;
        if (flags.intervaloInsuficiente || flags.intervaloObrigatorioAusente) violacoesIntervalo += 1;
        if (flags.jornadaAcimaLimiteLegal) violacoesJornada8h += 1;
      }

      if (ehDomingo || ehFeriadoSuspende) {
        if (extrasMinDia > 0) resumo.domingosEFeriados += 1;
        heDomingoFeriadoMin += extrasMinDia;
      } else if (extrasMinDia > 0) {
        heDiaUtilMin += extrasMinDia;
      }

      minutosNoturnos += calcularMinutosNoturnos(pontos);

      if (diaExigeJornada) resumo.diasUteis += 1;
      switch (statusDia) {
        case STATUS_DIA.TRABALHADO: resumo.trabalhados += 1; break;
        case STATUS_DIA.PARCIAL: resumo.parciais += 1; break;
        case STATUS_DIA.FALTA: resumo.faltas += 1; break;
        case STATUS_DIA.FOLGA: resumo.folgas += 1; break;
        case STATUS_DIA.JUSTIFICADA: resumo.justificadas += 1; break;
        case STATUS_DIA.FERIADO: resumo.feriados += 1; break;
        case STATUS_DIA.FERIAS: resumo.ferias += 1; break;
        case STATUS_DIA.EM_ABERTO: resumo.emAberto += 1; break;
        case STATUS_DIA.FUTURO: resumo.futuros += 1; break;
        default: break;
      }

      porUsuario[uid].diasTrabalhados[dia] = {
        pontos,
        statusDia,
        statusLabel: STATUS_DIA_LABEL[statusDia] || statusDia,
        minutosTrabalhados: minutos,
        horasTrabalhadas: fmtHours(minutos),
        extras: fmtHours(extrasMinDia),
        extrasMin: extrasMinDia,
        extrasCltMin: calc.extrasCltMin || 0,
        intervaloMinimo: calc.intervaloMinimo,
        intervaloMin: calc.intervaloMin,
        intervalo: calc.intervaloMin == null ? '' : fmtHours(calc.intervaloMin),
        marcacoes: {
          entrada: fmtTime(calc.entrada),
          saidaAlmoco: fmtTime(calc.saidaAlmoco),
          retornoAlmoco: fmtTime(calc.retornoAlmoco),
          saida: fmtTime(calc.saida),
        },
        origens: {
          entrada: origemDoTipoEm(pontos, 'ENTRADA', calc.entrada),
          saidaAlmoco: origemDoTipoEm(pontos, 'SAIDA_ALMOCO', calc.saidaAlmoco),
          retornoAlmoco: origemDoTipoEm(pontos, 'RETORNO_ALMOCO', calc.retornoAlmoco),
          saida: origemDoTipoEm(pontos, 'SAIDA', calc.saida),
        },
        flags,
        esperado: calc.esperado,
        jornadaContratualMin: calc.jornadaContratualMin,
        saldoDiaMin: minutos - espMin,
        contextoDia: {
          suspendeExpediente: esperadoZero,
          ehDomingo,
          ehFeriado: !!ehFeriadoSuspende,
          ...(feriado ? { feriado: { nome: feriado.nome, suspendeExpediente: feriado.suspendeExpediente } } : {}),
          ...(feriasNoDia ? { ferias: { dataInicio: feriasNoDia.dataInicio, dataFim: feriasNoDia.dataFim } } : {}),
          ...(comprovante ? {
            ausencia: {
              id: comprovante.id,
              tipo: ehFolgaComprovante ? 'FOLGA' : 'JUSTIFICADA',
              descricao: comprovante.descricao || null,
              manual: ehMarcadorManual,
            },
          } : {}),
          ...(meta?.dataAdmissao ? { dataAdmissao: fmtDateISO(meta.dataAdmissao) } : {}),
          ...(meta?.dataDemissao ? { dataDemissao: fmtDateISO(meta.dataDemissao) } : {}),
        },
      };
      totalMinutos += minutos;
      totalExtras += extrasMinDia;
    }

    let heSemanalMin = 0;
    let semanasCLT = {};
    if (clt.ativo) {
      const heSem = calcularHeSemanal(normaisPorSemana);
      heSemanalMin = heSem.totalHeSemanalMin;
      semanasCLT = heSem.porSemana;
      if (heSemanalMin > 0) heDiaUtilMin += heSemanalMin;
    }

    const horaExtraMesMin = Math.max(0, totalMinutos - totalEsperadoMin);
    const deficitMesMin = Math.max(0, totalEsperadoMin - totalMinutos);

    porUsuario[uid].totalHoras = fmtHours(totalMinutos);
    porUsuario[uid].totalExtras = fmtHours(totalExtras);
    porUsuario[uid].totalTrabalhadoMin = totalMinutos;
    porUsuario[uid].totalEsperadoMin = totalEsperadoMin;
    porUsuario[uid].saldoMesMin = totalMinutos - totalEsperadoMin;
    porUsuario[uid].horaExtraMesMin = horaExtraMesMin;
    porUsuario[uid].deficitMesMin = deficitMesMin;
    porUsuario[uid].horaExtraMes = fmtHours(horaExtraMesMin);
    porUsuario[uid].saldoMes = fmtHours(totalMinutos - totalEsperadoMin);
    porUsuario[uid].heDiaUtilMin = heDiaUtilMin;
    porUsuario[uid].heDomingoFeriadoMin = heDomingoFeriadoMin;
    porUsuario[uid].heSemanalMin = heSemanalMin;
    porUsuario[uid].minutosNoturnos = minutosNoturnos;
    if (clt.ativo) {
      porUsuario[uid].clt = {
        ativo: true,
        semanas: semanasCLT,
        violacoes: {
          intervalo: violacoesIntervalo,
          jornada8h: violacoesJornada8h,
          semanal44h: heSemanalMin > 0 ? 1 : 0,
        },
      };
    }
  }

  return porUsuario;
}

/** Minutos entre 22h e 5h (adicional noturno CLT simplificado). */
function calcularMinutosNoturnos(pontos) {
  let total = 0;
  const sorted = [...pontos].sort((a, b) => new Date(a.dataHora) - new Date(b.dataHora));
  for (let i = 0; i < sorted.length - 1; i += 2) {
    const ini = new Date(sorted[i].dataHora);
    const fim = new Date(sorted[i + 1].dataHora);
    total += overlapNoturnoMin(ini, fim);
  }
  return total;
}

function overlapNoturnoMin(ini, fim) {
  let total = 0;
  const cursor = new Date(ini);
  while (cursor < fim) {
    const h = cursor.getHours();
    if (h >= 22 || h < 5) total += 1;
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return total;
}

async function montarEspelhoMensal(tenantId, mesNum, anoNum, usuarioFiltroId = null) {
  const dataInicio = new Date(anoNum, mesNum - 1, 1);
  const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59);

  const registros = await prisma.registroPonto.findMany({
    where: whereRegistrosNoPeriodo({
      tenantId,
      usuarioId: usuarioFiltroId,
      dataInicio,
      dataFim,
    }),
    select: SELECT_REGISTRO_ESPELHO,
    orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
  });

  const porUsuario = await montarPorUsuarioEspelho(registros, tenantId, {
    mesNum,
    anoNum,
    usuarioFiltroId,
  });

  const fechamentos = await prisma.espelhoFechamento.findMany({
    where: {
      tenantId,
      mes: mesNum,
      ano: anoNum,
      ...(usuarioFiltroId && { usuarioId: String(usuarioFiltroId) }),
    },
    select: {
      id: true, usuarioId: true, mes: true, ano: true, status: true,
      aprovadoEm: true, solicitadoEm: true,
    },
  });
  const fechamentoPorUsuario = new Map(fechamentos.map((f) => [f.usuarioId, f]));
  for (const uid of Object.keys(porUsuario)) {
    porUsuario[uid].fechamento = fechamentoPorUsuario.get(uid) || null;
  }

  return {
    periodo: { mes: mesNum, ano: anoNum },
    relatorio: Object.values(porUsuario),
    porUsuario,
  };
}

module.exports = {
  montarEspelhoMensal,
  montarPorUsuarioEspelho,
  whereRegistrosNoPeriodo,
  SELECT_REGISTRO_ESPELHO,
  STATUS_DIA,
  STATUS_DIA_LABEL,
  fmtDateISO,
  diasDoMesISO,
};
