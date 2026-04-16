// src/controllers/relatorio.controller.js
const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const {
  calcularDia,
  escalaParaDia,
  fmtHours,
  fmtTime,
  pad2,
} = require('../utils/espelhoCalculo');

const prisma = new PrismaClient();

function fmtDateISO(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function whereRegistrosNoPeriodo({ tenantId, usuarioId, dataInicio, dataFim }) {
  // Importante: relatórios devem respeitar o horário efetivo (ajuste.dataHoraNova quando existir).
  // Sem isso, o admin "ajusta" mas o espelho continua filtrando pelo dataHora original e parece que não salvou.
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

/**
 * Agrupa registros por usuário/dia e aplica escalas + tolerância do tenant.
 */
async function montarPorUsuarioEspelho(registros, tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { toleranciaMinutos: true },
  });
  const tol = tenant?.toleranciaMinutos ?? 5;

  function origemDoTipoEm(pontos, tipo, dt) {
    if (!dt) return '';
    const t = new Date(dt).getTime();
    const achado = pontos.find((p) => p.tipo === tipo && new Date(p.dataHora).getTime() === t);
    return achado?.origem || '';
  }

  const uids = [...new Set(registros.map((r) => r.usuarioId))];
  const escalasAll = await prisma.escala.findMany({
    where: { tenantId, usuarioId: { in: uids }, ativo: true },
    orderBy: { updatedAt: 'desc' },
  });
  const escalasPorUsuario = {};
  for (const e of escalasAll) {
    if (!escalasPorUsuario[e.usuarioId]) escalasPorUsuario[e.usuarioId] = [];
    escalasPorUsuario[e.usuarioId].push(e);
  }

  const porUsuario = {};
  for (const r of registros) {
    const uid = r.usuarioId;
    if (!porUsuario[uid]) {
      porUsuario[uid] = {
        usuario: r.usuario,
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
      };
    }
    const dia = fmtDateISO(r.dataHora);
    if (!porUsuario[uid].diasTrabalhados[dia]) porUsuario[uid].diasTrabalhados[dia] = [];
    porUsuario[uid].diasTrabalhados[dia].push({
      id: r.id,
      tipo: r.tipo,
      dataHora: r.ajuste ? r.ajuste.dataHoraNova : r.dataHora,
      fotoUrl: r.fotoUrl,
      origem: r.origem,
      ajustado: !!r.ajuste,
      motivoAjuste: r.ajuste?.motivo,
    });
  }

  for (const uid in porUsuario) {
    let totalMinutos = 0;
    let totalExtras = 0;
    let totalEsperadoMin = 0;
    const listaEsc = escalasPorUsuario[uid] || [];

    for (const dia in porUsuario[uid].diasTrabalhados) {
      const pontos = porUsuario[uid].diasTrabalhados[dia];
      const escalaDia = escalaParaDia(listaEsc, dia);
      const calc = calcularDia(pontos, {
        escala: escalaDia || undefined,
        toleranciaMinutos: tol,
        dataRef: dia,
      });
      const minutos = calc.minutosTrabalhados;
      const espMin = escalaDia
        ? Math.round(Number(escalaDia.cargaHorariaDiaria) * 60)
        : 8 * 60;
      totalEsperadoMin += espMin;

      porUsuario[uid].diasTrabalhados[dia] = {
        pontos,
        minutosTrabalhados: minutos,
        horasTrabalhadas: fmtHours(minutos),
        extras: fmtHours(calc.extrasMin),
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
        flags: calc.flags,
        esperado: calc.esperado,
        jornadaContratualMin: calc.jornadaContratualMin,
        saldoDiaMin: minutos - espMin,
      };
      totalMinutos += minutos;
      totalExtras += calc.extrasMin;
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
  }

  return porUsuario;
}

async function espelhoPonto(req, res, next) {
  try {
    const { usuarioId, mes, ano } = req.query;
    const tenantId = req.tenantId;

    const mesNum = parseInt(mes) || new Date().getMonth() + 1;
    const anoNum = parseInt(ano) || new Date().getFullYear();
    const dataInicio = new Date(anoNum, mesNum - 1, 1);
    const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59);

    const registros = await prisma.registroPonto.findMany({
      where: whereRegistrosNoPeriodo({ tenantId, usuarioId, dataInicio, dataFim }),
      include: {
        usuario: { select: { id: true, nome: true, cargo: true, departamento: true } },
        ajuste: true,
      },
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    const porUsuario = await montarPorUsuarioEspelho(registros, tenantId);

    res.json({
      periodo: { mes: mesNum, ano: anoNum },
      relatorio: Object.values(porUsuario),
    });
  } catch (err) {
    next(err);
  }
}

function buildEspelhoRows(relatorio, periodo) {
  const rows = [];
  for (const item of relatorio) {
    const dias = item.diasTrabalhados || {};
    for (const dia of Object.keys(dias).sort()) {
      const d = dias[dia];
      const f = d.flags || {};
      const esp = d.esperado || null;
      const o = d.origens || {};
      rows.push({
        periodo: `${pad2(periodo.mes)}/${periodo.ano}`,
        dia,
        nome: item.usuario?.nome ?? '',
        cargo: item.usuario?.cargo ?? '',
        departamento: item.usuario?.departamento ?? '',
        entrada: d.marcacoes?.entrada ?? '',
        origemEntrada: o.entrada ?? '',
        saidaAlmoco: d.marcacoes?.saidaAlmoco ?? '',
        origemSaidaAlmoco: o.saidaAlmoco ?? '',
        retornoAlmoco: d.marcacoes?.retornoAlmoco ?? '',
        origemRetornoAlmoco: o.retornoAlmoco ?? '',
        saida: d.marcacoes?.saida ?? '',
        origemSaida: o.saida ?? '',
        entradaEsperada: esp?.entrada ?? '',
        saidaEsperada: esp?.saida ?? '',
        cargaHorariaPrevista: esp?.cargaHorariaDiaria != null ? String(esp.cargaHorariaDiaria) : '',
        intervalo: d.intervalo ?? '',
        horasTrabalhadas: d.horasTrabalhadas ?? '',
        extras: d.extras ?? '',
        faltandoMarcacao: f.faltandoMarcacao ? 'SIM' : 'NAO',
        intervaloInsuficiente: f.intervaloInsuficiente ? 'SIM' : 'NAO',
        jornadaExcedida: f.jornadaExcedida ? 'SIM' : 'NAO',
        entradaAtrasada: f.entradaAtrasada ? 'SIM' : 'NAO',
        saidaAntecipada: f.saidaAntecipada ? 'SIM' : 'NAO',
        almocoForaJanela: f.almocoForaDaJanela ? 'SIM' : 'NAO',
        saldoDia: d.saldoDiaMin != null ? fmtHours(d.saldoDiaMin) : '',
      });
    }
  }
  return rows;
}

function rowsToCsv(rows) {
  const headers = [
    'periodo',
    'dia',
    'nome',
    'cargo',
    'departamento',
    'entrada',
    'origemEntrada',
    'saidaAlmoco',
    'origemSaidaAlmoco',
    'retornoAlmoco',
    'origemRetornoAlmoco',
    'saida',
    'origemSaida',
    'entradaEsperada',
    'saidaEsperada',
    'cargaHorariaPrevista',
    'intervalo',
    'horasTrabalhadas',
    'extras',
    'faltandoMarcacao',
    'intervaloInsuficiente',
    'jornadaExcedida',
    'entradaAtrasada',
    'saidaAntecipada',
    'almocoForaJanela',
    'saldoDia',
  ];
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(';')];
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h])).join(';'));
  }
  return lines.join('\n');
}

async function espelhoExport(req, res, next) {
  try {
    const { usuarioId, mes, ano, format } = req.query;
    const tenantId = req.tenantId;

    const mesNum = parseInt(mes) || new Date().getMonth() + 1;
    const anoNum = parseInt(ano) || new Date().getFullYear();
    const dataInicio = new Date(anoNum, mesNum - 1, 1);
    const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59);

    const registros = await prisma.registroPonto.findMany({
      where: whereRegistrosNoPeriodo({ tenantId, usuarioId, dataInicio, dataFim }),
      include: {
        usuario: { select: { id: true, nome: true, cargo: true, departamento: true } },
        ajuste: true,
      },
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    const porUsuario = await montarPorUsuarioEspelho(registros, tenantId);
    const periodo = { mes: mesNum, ano: anoNum };
    const relatorio = Object.values(porUsuario);
    const rows = buildEspelhoRows(relatorio, periodo);

    const fmt = String(format || 'csv').toLowerCase();
    const baseName = `espelho_ponto_${pad2(mesNum)}_${anoNum}`;

    if (fmt === 'xlsx' || fmt === 'excel') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Espelho');
      ws.columns = [
        { header: 'Período', key: 'periodo', width: 10 },
        { header: 'Dia', key: 'dia', width: 12 },
        { header: 'Nome', key: 'nome', width: 28 },
        { header: 'Cargo', key: 'cargo', width: 16 },
        { header: 'Departamento', key: 'departamento', width: 18 },
        { header: 'Entrada', key: 'entrada', width: 10 },
        { header: 'Origem (Entrada)', key: 'origemEntrada', width: 16 },
        { header: 'Saída Almoço', key: 'saidaAlmoco', width: 12 },
        { header: 'Origem (Saída Almoço)', key: 'origemSaidaAlmoco', width: 20 },
        { header: 'Retorno Almoço', key: 'retornoAlmoco', width: 13 },
        { header: 'Origem (Retorno)', key: 'origemRetornoAlmoco', width: 18 },
        { header: 'Saída', key: 'saida', width: 10 },
        { header: 'Origem (Saída)', key: 'origemSaida', width: 16 },
        { header: 'Entrada esperada (escala)', key: 'entradaEsperada', width: 16 },
        { header: 'Saída esperada (escala)', key: 'saidaEsperada', width: 16 },
        { header: 'Carga prevista (h)', key: 'cargaHorariaPrevista', width: 12 },
        { header: 'Intervalo', key: 'intervalo', width: 10 },
        { header: 'Horas trabalhadas', key: 'horasTrabalhadas', width: 14 },
        { header: 'Extras no dia', key: 'extras', width: 12 },
        { header: 'Faltando marcação', key: 'faltandoMarcacao', width: 16 },
        { header: 'Intervalo insuficiente', key: 'intervaloInsuficiente', width: 18 },
        { header: 'Jornada excedida', key: 'jornadaExcedida', width: 14 },
        { header: 'Entrada atrasada', key: 'entradaAtrasada', width: 14 },
        { header: 'Saída antecipada', key: 'saidaAntecipada', width: 14 },
        { header: 'Almoço fora da janela', key: 'almocoForaJanela', width: 18 },
        { header: 'Saldo dia', key: 'saldoDia', width: 12 },
      ];
      ws.addRows(rows);
      ws.getRow(1).font = { bold: true };

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      await wb.xlsx.write(res);
      return res.end();
    }

    if (fmt === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);

      const doc = new PDFDocument({ size: 'A4', margin: 28 });
      doc.pipe(res);
      doc.fontSize(14).text('Espelho de Ponto', { align: 'left' });
      doc.fontSize(10).text(`Período: ${pad2(mesNum)}/${anoNum}`, { align: 'left' });
      doc.moveDown(0.5);

      const headers = ['Dia', 'Nome', 'Entrada', 'Saída', 'Horas', 'Extras', 'Flags'];
      const colW = [52, 140, 44, 44, 44, 44, 120];
      const startX = doc.x;
      let y = doc.y;

      function rowLine(vals, bold) {
        let x = startX;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
        for (let i = 0; i < vals.length; i++) {
          doc.text(String(vals[i] ?? ''), x, y, { width: colW[i], ellipsis: true });
          x += colW[i];
        }
        y += 11;
        if (y > doc.page.height - 40) {
          doc.addPage();
          y = doc.y;
        }
      }

      rowLine(headers, true);
      for (const r of rows) {
        const flags = [];
        if (r.faltandoMarcacao === 'SIM') flags.push('FALTA');
        if (r.intervaloInsuficiente === 'SIM') flags.push('INTERV');
        if (r.jornadaExcedida === 'SIM') flags.push('EXCED');
        if (r.entradaAtrasada === 'SIM') flags.push('ATRASO');
        if (r.saidaAntecipada === 'SIM') flags.push('SAIDA_ANT');
        if (r.almocoForaJanela === 'SIM') flags.push('ALMOCO');
        rowLine(
          [r.dia, r.nome, r.entrada, r.saida, r.horasTrabalhadas, r.extras, flags.join(',')],
          false
        );
      }
      doc.end();
      return;
    }

    const csv = rowsToCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/** Resumo de banco de horas / HE no mês (com base na escala ou 8h padrão por dia trabalhado) */
async function bancoHorasResumo(req, res, next) {
  try {
    const { usuarioId, mes, ano } = req.query;
    const tenantId = req.tenantId;

    const mesNum = parseInt(mes) || new Date().getMonth() + 1;
    const anoNum = parseInt(ano) || new Date().getFullYear();
    const dataInicio = new Date(anoNum, mesNum - 1, 1);
    const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59);

    const registros = await prisma.registroPonto.findMany({
      where: whereRegistrosNoPeriodo({ tenantId, usuarioId, dataInicio, dataFim }),
      include: {
        usuario: { select: { id: true, nome: true, cargo: true, departamento: true } },
        ajuste: true,
      },
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    const porUsuario = await montarPorUsuarioEspelho(registros, tenantId);
    const lista = Object.values(porUsuario).map((u) => ({
      usuario: u.usuario,
      totalTrabalhadoMin: u.totalTrabalhadoMin,
      totalEsperadoMin: u.totalEsperadoMin,
      saldoMesMin: u.saldoMesMin,
      horaExtraMesMin: u.horaExtraMesMin,
      deficitMesMin: u.deficitMesMin,
      totalHoras: u.totalHoras,
      horaExtraMes: u.horaExtraMes,
      saldoMes: u.saldoMes,
    }));

    res.json({
      periodo: { mes: mesNum, ano: anoNum },
      obs: 'Saldo = trabalhado − esperado por dia (esperado da escala ativa ou 8h se não houver escala no dia).',
      resumo: lista,
    });
  } catch (err) {
    next(err);
  }
}

async function resumoDia(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);

    const [totalColaboradores, registrosHoje] = await Promise.all([
      prisma.usuario.count({ where: { tenantId, ativo: true, role: 'COLABORADOR' } }),
      prisma.registroPonto.findMany({
        where: { tenantId, dataHora: { gte: inicio, lte: fim } },
        select: { usuarioId: true, tipo: true, dataHora: true },
      }),
    ]);

    const presentes = new Set();
    const ausentes = new Set();
    for (const r of registrosHoje) {
      if (r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_ALMOCO') presentes.add(r.usuarioId);
      if (r.tipo === 'SAIDA') {
        presentes.delete(r.usuarioId);
        ausentes.add(r.usuarioId);
      }
    }

    res.json({
      totalColaboradores,
      presentes: presentes.size,
      ausentes: totalColaboradores - presentes.size - ausentes.size,
      registrosHoje: registrosHoje.length,
    });
  } catch (err) {
    next(err);
  }
}

async function ajustarPonto(req, res, next) {
  try {
    const { registroId, dataHoraNova, motivo } = req.body;
    const tenantId = req.tenantId;
    const adminId = req.usuario.id;

    if (!registroId || !dataHoraNova || !motivo) {
      return res.status(400).json({ error: 'registroId, dataHoraNova e motivo são obrigatórios' });
    }

    const registro = await prisma.registroPonto.findFirst({
      where: { id: registroId, tenantId },
    });
    if (!registro) return res.status(404).json({ error: 'Registro não encontrado' });

    const ajuste = await prisma.ajustePonto.upsert({
      where: { registroId },
      update: { dataHoraNova: new Date(dataHoraNova), motivo, adminId },
      create: {
        tenantId,
        registroId,
        adminId,
        dataHoraOriginal: registro.dataHora,
        dataHoraNova: new Date(dataHoraNova),
        motivo,
      },
    });

    res.json({ sucesso: true, ajuste });
  } catch (err) {
    next(err);
  }
}

async function inserirPontoManual(req, res, next) {
  try {
    const { usuarioId, tipo, dataHora, motivo } = req.body;
    const tenantId = req.tenantId;
    const adminId = req.usuario.id;

    if (!usuarioId || !tipo || !dataHora || !motivo) {
      return res.status(400).json({ error: 'usuarioId, tipo, dataHora e motivo são obrigatórios' });
    }

    const tiposValidos = ['ENTRADA', 'SAIDA_ALMOCO', 'RETORNO_ALMOCO', 'SAIDA'];
    if (!tiposValidos.includes(String(tipo).toUpperCase())) {
      return res.status(400).json({ error: 'Tipo de ponto inválido' });
    }

    const alvo = await prisma.usuario.findFirst({
      where: { id: usuarioId, tenantId, role: 'COLABORADOR', ativo: true },
      select: { id: true },
    });
    if (!alvo) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const dh = new Date(dataHora);
    if (Number.isNaN(dh.getTime())) return res.status(400).json({ error: 'dataHora inválida' });

    // Um tipo por dia (mesma regra do registro automático, mas aplicado no dia informado)
    const inicio = new Date(dh.getFullYear(), dh.getMonth(), dh.getDate(), 0, 0, 0, 0);
    const fim = new Date(dh.getFullYear(), dh.getMonth(), dh.getDate(), 23, 59, 59, 999);
    const jaExiste = await prisma.registroPonto.findFirst({
      where: { tenantId, usuarioId, tipo: String(tipo).toUpperCase(), dataHora: { gte: inicio, lte: fim } },
      select: { id: true, dataHora: true },
    });
    if (jaExiste) {
      return res.status(409).json({
        error: 'Já existe uma marcação deste tipo para este colaborador neste dia.',
        code: 'DUPLICADO_DIA',
        registroId: jaExiste.id,
        dataHora: jaExiste.dataHora,
      });
    }

    const registro = await prisma.registroPonto.create({
      data: {
        tenantId,
        usuarioId,
        tipo: String(tipo).toUpperCase(),
        dataHora: dh,
        origem: 'ADMIN_MANUAL',
        validado: true,
      },
    });

    // Reaproveita a tabela de ajustes como trilha/auditoria da justificativa,
    // mesmo quando o registro já nasce com o horário "correto".
    const ajuste = await prisma.ajustePonto.create({
      data: {
        tenantId,
        registroId: registro.id,
        adminId,
        dataHoraOriginal: dh,
        dataHoraNova: dh,
        motivo: String(motivo).trim(),
        aprovado: true,
      },
    });

    return res.status(201).json({ sucesso: true, registro, ajuste });
  } catch (err) {
    next(err);
  }
}

async function listarSolicitacoesAjuste(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const status = String(req.query.status || 'PENDENTE').toUpperCase();
    const take = Math.min(200, Math.max(1, parseInt(req.query.limite || '50', 10)));

    const where = {
      tenantId,
      ...(status ? { status } : {}),
    };

    const solicitacoes = await prisma.solicitacaoAjustePonto.findMany({
      where,
      include: {
        usuario: { select: { id: true, nome: true, cargo: true, departamento: true } },
        respondidoPor: { select: { id: true, nome: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    res.json({ solicitacoes });
  } catch (err) {
    next(err);
  }
}

async function decidirSolicitacaoAjuste(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const adminId = req.usuario.id;
    const { id } = req.params;
    const { acao, respostaAdmin, dataHoraEfetiva } = req.body || {};

    const sol = await prisma.solicitacaoAjustePonto.findFirst({
      where: { id, tenantId },
    });
    if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada' });
    if (sol.status !== 'PENDENTE') {
      return res.status(409).json({ error: 'Solicitação já foi decidida' });
    }

    const a = String(acao || '').toUpperCase();
    if (a !== 'APROVAR' && a !== 'REJEITAR') {
      return res.status(400).json({ error: 'acao deve ser APROVAR ou REJEITAR' });
    }

    if (a === 'REJEITAR') {
      const upd = await prisma.solicitacaoAjustePonto.update({
        where: { id },
        data: {
          status: 'REJEITADA',
          respondidoPorId: adminId,
          respondidoEm: new Date(),
          respostaAdmin: respostaAdmin ? String(respostaAdmin).trim() : null,
        },
      });
      return res.json({ sucesso: true, solicitacao: upd });
    }

    // APROVAR: inserir a batida faltante (ADMIN_MANUAL) com motivo contendo a justificativa do colaborador
    const dh =
      dataHoraEfetiva != null
        ? new Date(dataHoraEfetiva)
        : sol.dataHoraSugerida
          ? new Date(sol.dataHoraSugerida)
          : null;
    if (!dh || Number.isNaN(dh.getTime())) {
      return res.status(400).json({ error: 'Informe dataHoraEfetiva (ou o colaborador precisa sugerir um horário)' });
    }

    // regra: um tipo por dia (considera dia da dataHoraEfetiva)
    const inicio = new Date(dh.getFullYear(), dh.getMonth(), dh.getDate(), 0, 0, 0, 0);
    const fim = new Date(dh.getFullYear(), dh.getMonth(), dh.getDate(), 23, 59, 59, 999);
    const jaExiste = await prisma.registroPonto.findFirst({
      where: {
        tenantId,
        usuarioId: sol.usuarioId,
        tipo: sol.tipo,
        deletedAt: null,
        dataHora: { gte: inicio, lte: fim },
      },
      select: { id: true, dataHora: true },
    });
    if (jaExiste) {
      return res.status(409).json({
        error: 'Já existe uma batida desse tipo nesse dia. Use Ajustar em vez de Aprovar esta solicitação.',
        code: 'DUPLICADO_DIA',
        registroId: jaExiste.id,
        dataHora: jaExiste.dataHora,
      });
    }

    const motivoBase = `[Solicitação colaborador] ${sol.justificativa}`;
    const motivoFinal = respostaAdmin ? `${motivoBase}\n[Resposta admin] ${String(respostaAdmin).trim()}` : motivoBase;

    const registro = await prisma.registroPonto.create({
      data: {
        tenantId,
        usuarioId: sol.usuarioId,
        tipo: sol.tipo,
        dataHora: dh,
        origem: 'ADMIN_MANUAL',
        validado: true,
      },
    });

    const ajuste = await prisma.ajustePonto.create({
      data: {
        tenantId,
        registroId: registro.id,
        adminId,
        dataHoraOriginal: dh,
        dataHoraNova: dh,
        motivo: motivoFinal,
        aprovado: true,
      },
    });

    const upd = await prisma.solicitacaoAjustePonto.update({
      where: { id },
      data: {
        status: 'ATENDIDA',
        respondidoPorId: adminId,
        respondidoEm: new Date(),
        respostaAdmin: respostaAdmin ? String(respostaAdmin).trim() : null,
      },
    });

    return res.json({ sucesso: true, solicitacao: upd, registro, ajuste });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  espelhoPonto,
  espelhoExport,
  bancoHorasResumo,
  resumoDia,
  ajustarPonto,
  inserirPontoManual,
  listarSolicitacoesAjuste,
  decidirSolicitacaoAjuste,
};
