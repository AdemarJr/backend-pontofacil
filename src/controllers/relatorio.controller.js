// src/controllers/relatorio.controller.js
const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const {
  calcularDia,
  escalaParaDia,
  fmtHours,
  fmtTime,
  pad2,
  parseHoraMinutos,
} = require('../utils/espelhoCalculo');

const prisma = require('../infra/prisma');
const { montarPorUsuarioEspelho, montarEspelhoMensal } = require('../modules/relatorios/espelho.service');

/**
 * Campos do RegistroPonto usados pelo espelho/relatórios.
 * IMPORTANTE: `fotoUrl` é EXCLUÍDO de propósito. Ele guarda a imagem em base64
 * (~50 KB por marcação) direto no banco; ao montar um mês inteiro para vários
 * colaboradores, transferir todas as fotos deixa a query absurdamente lenta
 * (dezenas de segundos → timeout). A foto não é usada no relatório; se for
 * preciso visualizá-la, deve ser buscada sob demanda por registro.
 */
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

/**
 * Marcador usado no campo `tipoArquivo` de ComprovanteAusencia para diferenciar
 * uma FOLGA (dispensa sem documento) de um atestado/comprovante real.
 */
const FOLGA_TIPO_ARQUIVO = 'FOLGA';

/** Status possíveis de um dia no espelho. */
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

/**
 * Entradas de gerente vindas de <input type="datetime-local"> chegam como "YYYY-MM-DDTHH:mm" sem fuso.
 * No Node em UTC, `new Date(isoSemFuso)` trata como horário UTC — erro típico de ~3h no Brasil.
 * Strings com Z ou offset são interpretadas normalmente.
 * Sem fuso explícito, assume horário civil de Brasília (UTC−3, sem horário de verão desde 2019).
 */
function parseDataHoraGerenteInput(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value ?? '').trim();
  if (!s) return null;
  const hasExplicitTz = /(Z|[+\-]\d{2}:?\d{2})$/.test(s);
  if (hasExplicitTz) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const day = Number(m[3]);
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const sec = m[6] != null ? Number(m[6]) : 0;
    const offsetBrasiliaHoras = 3;
    return new Date(Date.UTC(y, mo, day, h + offsetBrasiliaHoras, mi, sec));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
      select: SELECT_REGISTRO_ESPELHO,
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    const porUsuario = await montarPorUsuarioEspelho(registros, tenantId, {
      mesNum,
      anoNum,
      usuarioFiltroId: usuarioId || null,
    });

    const fechamentos = await prisma.espelhoFechamento.findMany({
      where: {
        tenantId,
        mes: mesNum,
        ano: anoNum,
        ...(usuarioId && { usuarioId: String(usuarioId) }),
      },
      select: {
        id: true,
        usuarioId: true,
        mes: true,
        ano: true,
        status: true,
        aprovadoEm: true,
        solicitadoEm: true,
        solicitadoPor: { select: { id: true, nome: true } },
        createdAt: true,
      },
    });
    const fechamentoPorUsuario = new Map(fechamentos.map((f) => [f.usuarioId, f]));
    for (const uid of Object.keys(porUsuario)) {
      porUsuario[uid].fechamento = fechamentoPorUsuario.get(uid) || null;
    }

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
      const ctx = d.contextoDia || null;
      let contextoDia = '';
      if (ctx?.feriado?.nome && ctx?.feriado?.suspendeExpediente) contextoDia = `Feriado: ${ctx.feriado.nome}`;
      else if (ctx?.ferias) contextoDia = `Férias (${ctx.ferias.dataInicio} → ${ctx.ferias.dataFim})`;
      else if (ctx?.ausencia) {
        const pref = ctx.ausencia.tipo === 'FOLGA' ? 'Folga' : 'Falta justificada';
        contextoDia = ctx.ausencia.descricao ? `${pref}: ${ctx.ausencia.descricao}` : pref;
      } else if (ctx?.suspendeExpediente) {
        if (ctx?.dataAdmissao) contextoDia = `Antes da admissão (a partir de ${ctx.dataAdmissao})`;
        else if (ctx?.dataDemissao) contextoDia = `Após demissão (${ctx.dataDemissao})`;
      }
      rows.push({
        periodo: `${pad2(periodo.mes)}/${periodo.ano}`,
        dia,
        nome: item.usuario?.nome ?? '',
        cargo: item.usuario?.cargo ?? '',
        departamento: item.usuario?.departamento ?? '',
        status: d.statusLabel ?? d.statusDia ?? '',
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
        contextoDia,
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
    'status',
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
    'contextoDia',
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
      select: SELECT_REGISTRO_ESPELHO,
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    const porUsuario = await montarPorUsuarioEspelho(registros, tenantId, {
      mesNum,
      anoNum,
      usuarioFiltroId: usuarioId || null,
    });
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
        { header: 'Status do dia', key: 'status', width: 18 },
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
        { header: 'Contexto (feriado/férias)', key: 'contextoDia', width: 28 },
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

      const headers = ['Dia', 'Nome', 'Status', 'Entrada', 'Saída', 'Horas', 'Extras', 'Ctx', 'Flags'];
      const colW = [50, 104, 66, 38, 38, 38, 38, 76, 76];
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
          [r.dia, r.nome, r.status || '', r.entrada, r.saida, r.horasTrabalhadas, r.extras, r.contextoDia || '', flags.join(',')],
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

function hashEspelhoRows(rows) {
  // Hash estável do conteúdo do espelho exportável (garante integridade no aceite)
  const payload = JSON.stringify(rows);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/** Colaborador: espelho mensal do próprio usuário (visualização) */
async function espelhoMeu(req, res, next) {
  try {
    const { mes, ano } = req.query;
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;

    const mesNum = parseInt(mes) || new Date().getMonth() + 1;
    const anoNum = parseInt(ano) || new Date().getFullYear();
    const dataInicio = new Date(anoNum, mesNum - 1, 1);
    const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59);

    const registros = await prisma.registroPonto.findMany({
      where: whereRegistrosNoPeriodo({ tenantId, usuarioId, dataInicio, dataFim }),
      select: SELECT_REGISTRO_ESPELHO,
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    const porUsuario = await montarPorUsuarioEspelho(registros, tenantId, {
      mesNum,
      anoNum,
      usuarioFiltroId: usuarioId,
    });
    const periodo = { mes: mesNum, ano: anoNum };
    const relatorio = Object.values(porUsuario);
    const rows = buildEspelhoRows(relatorio, periodo);
    const espelhoHash = hashEspelhoRows(rows);

    const fechamento = await prisma.espelhoFechamento.findFirst({
      where: { tenantId, usuarioId, mes: mesNum, ano: anoNum },
      select: {
        id: true,
        mes: true,
        ano: true,
        status: true,
        espelhoHash: true,
        aprovadoEm: true,
        solicitadoEm: true,
        solicitadoPor: { select: { id: true, nome: true } },
        createdAt: true,
      },
    });

    const assinaturaPadrao = await prisma.usuario.findFirst({
      where: { id: usuarioId, tenantId },
      select: { assinaturaPadraoDataUrl: true, assinaturaPadraoAtualizadaEm: true },
    });

    return res.json({
      periodo,
      espelho: relatorio[0] || null,
      espelhoHash,
      fechamento,
      assinaturaPadrao: {
        existe: Boolean(assinaturaPadrao?.assinaturaPadraoDataUrl),
        atualizadaEm: assinaturaPadrao?.assinaturaPadraoAtualizadaEm || null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** Colaborador: export do próprio espelho (csv/xlsx/pdf) */
async function espelhoMeuExport(req, res, next) {
  try {
    const { mes, ano, format } = req.query;
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;

    const mesNum = parseInt(mes) || new Date().getMonth() + 1;
    const anoNum = parseInt(ano) || new Date().getFullYear();
    const dataInicio = new Date(anoNum, mesNum - 1, 1);
    const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59);

    const registros = await prisma.registroPonto.findMany({
      where: whereRegistrosNoPeriodo({ tenantId, usuarioId, dataInicio, dataFim }),
      select: SELECT_REGISTRO_ESPELHO,
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    const porUsuario = await montarPorUsuarioEspelho(registros, tenantId, {
      mesNum,
      anoNum,
      usuarioFiltroId: usuarioId,
    });
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
        { header: 'Status do dia', key: 'status', width: 18 },
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
        { header: 'Contexto (feriado/férias)', key: 'contextoDia', width: 28 },
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

      const headers = ['Dia', 'Nome', 'Status', 'Entrada', 'Saída', 'Horas', 'Extras', 'Ctx', 'Flags'];
      const colW = [50, 104, 66, 38, 38, 38, 38, 76, 76];
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
          [r.dia, r.nome, r.status || '', r.entrada, r.saida, r.horasTrabalhadas, r.extras, r.contextoDia || '', flags.join(',')],
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

/** Colaborador: status do fechamento do mês */
async function fechamentoStatus(req, res, next) {
  try {
    const { mes, ano } = req.query;
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;
    const mesNum = parseInt(mes) || new Date().getMonth() + 1;
    const anoNum = parseInt(ano) || new Date().getFullYear();

    const fechamento = await prisma.espelhoFechamento.findFirst({
      where: { tenantId, usuarioId, mes: mesNum, ano: anoNum },
      select: {
        id: true,
        mes: true,
        ano: true,
        status: true,
        espelhoHash: true,
        aprovadoEm: true,
        solicitadoEm: true,
        solicitadoPor: { select: { id: true, nome: true } },
        createdAt: true,
      },
    });

    return res.json({ periodo: { mes: mesNum, ano: anoNum }, fechamento });
  } catch (err) {
    next(err);
  }
}

/** Colaborador: aprovar/assinar o espelho do mês */
async function fechamentoAprovar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;
    const { mes, ano, assinaturaDataUrl, assinaturaStrokes, deviceId } = req.body || {};

    const mesNum = parseInt(mes) || new Date().getMonth() + 1;
    const anoNum = parseInt(ano) || new Date().getFullYear();
    const dataInicio = new Date(anoNum, mesNum - 1, 1);
    const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59);

    const registros = await prisma.registroPonto.findMany({
      where: whereRegistrosNoPeriodo({ tenantId, usuarioId, dataInicio, dataFim }),
      select: SELECT_REGISTRO_ESPELHO,
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    const porUsuario = await montarPorUsuarioEspelho(registros, tenantId, {
      mesNum,
      anoNum,
      usuarioFiltroId: usuarioId,
    });
    const periodo = { mes: mesNum, ano: anoNum };
    const relatorio = Object.values(porUsuario);
    const rows = buildEspelhoRows(relatorio, periodo);
    const espelhoHash = hashEspelhoRows(rows);

    const ipHash = crypto
      .createHash('sha256')
      .update(req.ip || '')
      .digest('hex')
      .substring(0, 16);

    const ua = req.headers['user-agent']?.substring(0, 200) || null;
    const assinaturaUrl = typeof assinaturaDataUrl === 'string' && assinaturaDataUrl.startsWith('data:image/')
      ? assinaturaDataUrl
      : null;

    const usuarioAss = await prisma.usuario.findFirst({
      where: { id: usuarioId, tenantId },
      select: {
        assinaturaPadraoDataUrl: true,
        assinaturaPadraoStrokes: true,
      },
    });

    // Assinatura única: se não vier assinatura no request, reutiliza a assinatura padrão (se existir).
    const assinaturaFinalUrl = assinaturaUrl || usuarioAss?.assinaturaPadraoDataUrl || null;
    const assinaturaFinalStrokes =
      assinaturaUrl != null
        ? (assinaturaStrokes ?? undefined)
        : (usuarioAss?.assinaturaPadraoStrokes ?? undefined);

    if (!assinaturaFinalUrl) {
      return res.status(400).json({
        error:
          'Assinatura necessária no primeiro aceite. Desenhe sua assinatura uma vez; nos próximos meses você poderá apenas aprovar.',
      });
    }

    const existente = await prisma.espelhoFechamento.findFirst({
      where: { tenantId, usuarioId, mes: mesNum, ano: anoNum },
      select: { id: true },
    });

    // Se o colaborador enviou uma assinatura nova, salva como assinatura padrão para os próximos meses.
    if (assinaturaUrl) {
      await prisma.usuario.update({
        where: { id: usuarioId },
        data: {
          assinaturaPadraoDataUrl: assinaturaUrl,
          assinaturaPadraoStrokes: assinaturaStrokes ?? undefined,
          assinaturaPadraoAtualizadaEm: new Date(),
        },
      });
    }

    const fechamento = existente
      ? await prisma.espelhoFechamento.update({
          where: { id: existente.id },
          data: {
            // Mantém histórico coerente: se o espelho mudou (ajuste posterior), o hash precisa acompanhar.
            // Na prática, o RH deveria "reabrir" o mês; mas para MVP, atualizamos hash e registra nova data.
            status: 'ASSINADO',
            espelhoHash,
            aprovadoEm: new Date(),
            assinaturaDataUrl: assinaturaFinalUrl,
            assinaturaStrokes: assinaturaFinalStrokes,
            ipHash,
            userAgent: ua,
            deviceId: deviceId ? String(deviceId).substring(0, 120) : null,
          },
          select: {
            id: true,
            mes: true,
            ano: true,
            status: true,
            espelhoHash: true,
            aprovadoEm: true,
            createdAt: true,
          },
        })
      : await prisma.espelhoFechamento.create({
          data: {
            tenantId,
            usuarioId,
            mes: mesNum,
            ano: anoNum,
            status: 'ASSINADO',
            espelhoHash,
            aprovadoEm: new Date(),
            assinaturaDataUrl: assinaturaFinalUrl,
            assinaturaStrokes: assinaturaFinalStrokes,
            ipHash,
            userAgent: ua,
            deviceId: deviceId ? String(deviceId).substring(0, 120) : null,
          },
          select: {
            id: true,
            mes: true,
            ano: true,
            status: true,
            espelhoHash: true,
            aprovadoEm: true,
            createdAt: true,
          },
        });

    return res.json({ sucesso: true, periodo, fechamento });
  } catch (err) {
    next(err);
  }
}

/** Admin: pedir ao colaborador que revise e assine o espelho do mês (fica AGUARDANDO_ASSINATURA). */
async function solicitarAssinaturaEspelho(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const adminId = req.usuario.id;
    const { usuarioId, mes, ano } = req.body || {};

    if (!usuarioId) {
      return res.status(400).json({ error: 'usuarioId é obrigatório' });
    }

    const mesNum = parseInt(mes, 10) || new Date().getMonth() + 1;
    const anoNum = parseInt(ano, 10) || new Date().getFullYear();

    const colab = await prisma.usuario.findFirst({
      where: { id: String(usuarioId), tenantId, role: 'COLABORADOR', ativo: true },
      select: { id: true, nome: true },
    });
    if (!colab) {
      return res.status(404).json({ error: 'Colaborador não encontrado' });
    }

    const existente = await prisma.espelhoFechamento.findFirst({
      where: { tenantId, usuarioId: colab.id, mes: mesNum, ano: anoNum },
      select: { id: true },
    });

    const agora = new Date();
    const dadosAguardando = {
      status: 'AGUARDANDO_ASSINATURA',
      solicitadoPorId: adminId,
      solicitadoEm: agora,
      espelhoHash: null,
      aprovadoEm: null,
      assinaturaDataUrl: null,
      assinaturaStrokes: null,
      ipHash: null,
      userAgent: null,
      deviceId: null,
    };

    const fechamento = existente
      ? await prisma.espelhoFechamento.update({
          where: { id: existente.id },
          data: dadosAguardando,
          select: {
            id: true,
            mes: true,
            ano: true,
            status: true,
            solicitadoEm: true,
            solicitadoPor: { select: { id: true, nome: true } },
          },
        })
      : await prisma.espelhoFechamento.create({
          data: {
            tenantId,
            usuarioId: colab.id,
            mes: mesNum,
            ano: anoNum,
            ...dadosAguardando,
          },
          select: {
            id: true,
            mes: true,
            ano: true,
            status: true,
            solicitadoEm: true,
            solicitadoPor: { select: { id: true, nome: true } },
          },
        });

    return res.json({
      sucesso: true,
      periodo: { mes: mesNum, ano: anoNum },
      colaborador: colab,
      fechamento,
    });
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
      select: SELECT_REGISTRO_ESPELHO,
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    const porUsuario = await montarPorUsuarioEspelho(registros, tenantId, {
      mesNum,
      anoNum,
      usuarioFiltroId: usuarioId || null,
    });
    const lista = Object.values(porUsuario).map((u) => ({
      usuario: u.usuario,
      totalTrabalhadoMin: u.totalTrabalhadoMin,
      totalEsperadoMin: u.totalEsperadoMin,
      saldoMesMin: u.saldoMesMin,
      horaExtraMesMin: u.horaExtraMesMin,
      heDiaUtilMin: u.heDiaUtilMin,
      heSemanalMin: u.heSemanalMin,
      deficitMesMin: u.deficitMesMin,
      totalHoras: u.totalHoras,
      horaExtraMes: u.horaExtraMes,
      saldoMes: u.saldoMes,
      diasResumo: u.resumo,
      clt: u.clt,
    }));

    res.json({
      periodo: { mes: mesNum, ano: anoNum },
      obs:
        'Saldo = trabalhado − esperado. HE inclui excedente diário (acima de 8h CLT) e semanal (acima de 44h). O esperado conta apenas dias úteis devidos; folgas, feriados, férias e justificadas têm esperado 0.',
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
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999);
    const diaIso = fmtDateISO(hoje);
    const agoraMin = hoje.getHours() * 60 + hoje.getMinutes();

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { toleranciaMinutos: true },
    });
    const tol = tenant?.toleranciaMinutos ?? 5;

    const [
      feriadoHoje,
      feriasRows,
      colaboradoresAtivos,
      registrosHoje,
      comprovantesAprovados,
      escalasAll,
    ] = await Promise.all([
      prisma.feriado.findFirst({
        where: { tenantId, data: diaIso, suspendeExpediente: true },
        select: { id: true, nome: true },
      }),
      prisma.ferias.findMany({
        where: {
          tenantId,
          status: 'APROVADA',
          dataInicio: { lte: diaIso },
          dataFim: { gte: diaIso },
        },
        include: {
          usuario: { select: { id: true, nome: true, cargo: true, departamento: true } },
        },
      }),
      prisma.usuario.findMany({
        where: { tenantId, ativo: true, role: 'COLABORADOR' },
        select: { id: true, nome: true, cargo: true, departamento: true, dataAdmissao: true, dataDemissao: true },
        orderBy: { nome: 'asc' },
      }),
      prisma.registroPonto.findMany({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { ajuste: { is: null }, dataHora: { gte: inicio, lte: fim } },
            { ajuste: { is: { dataHoraNova: { gte: inicio, lte: fim } } } },
          ],
        },
        select: {
          usuarioId: true,
          tipo: true,
          dataHora: true,
          ajuste: { select: { dataHoraNova: true } },
        },
      }),
      prisma.comprovanteAusencia.findMany({
        where: {
          tenantId,
          status: 'APROVADO',
          OR: [
            { dataFim: null, dataReferencia: diaIso },
            { dataFim: { not: null }, dataReferencia: { lte: diaIso }, dataFim: { gte: diaIso } },
          ],
        },
        include: {
          usuario: { select: { id: true, nome: true, cargo: true, departamento: true } },
        },
      }),
      prisma.escala.findMany({
        where: { tenantId, ativo: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const feriasSet = new Set((feriasRows || []).map((f) => f.usuarioId));

    const escalasPorUsuario = {};
    for (const e of escalasAll || []) {
      if (!escalasPorUsuario[e.usuarioId]) escalasPorUsuario[e.usuarioId] = [];
      escalasPorUsuario[e.usuarioId].push(e);
    }

    function esDiaUtil(uid) {
      const lista = escalasPorUsuario[uid] || [];
      if (!lista.length) {
        const d = new Date(`${diaIso}T12:00:00`);
        const dow = d.getDay();
        return dow >= 1 && dow <= 5;
      }
      return escalaParaDia(lista, diaIso) != null;
    }

    function prazoEntradaMin(uid) {
      const esc = escalaParaDia(escalasPorUsuario[uid] || [], diaIso);
      const esp = esc ? parseHoraMinutos(esc.horaInicio) : 8 * 60;
      if (esp == null) return 8 * 60 + tol;
      return esp + tol;
    }

    const elegiveis = colaboradoresAtivos.filter((u) => {
      const admOk = u.dataAdmissao ? fmtDateISO(u.dataAdmissao) <= diaIso : true;
      const naoDemitido = u.dataDemissao ? fmtDateISO(u.dataDemissao) >= diaIso : true;
      return admOk && naoDemitido && !feriasSet.has(u.id);
    });

    const totalColaboradores = elegiveis.length;

    const effDh = (r) => (r.ajuste?.dataHoraNova ? r.ajuste.dataHoraNova : r.dataHora);
    const registrosOrdenados = [...registrosHoje].sort((a, b) => new Date(effDh(a)) - new Date(effDh(b)));

    const presentes = new Set();
    const sairam = new Set();
    for (const r of registrosOrdenados) {
      if (r.tipo === 'ENTRADA' || r.tipo === 'RETORNO_ALMOCO') presentes.add(r.usuarioId);
      if (r.tipo === 'SAIDA') {
        presentes.delete(r.usuarioId);
        sairam.add(r.usuarioId);
      }
    }

    const pontosPorUsuario = {};
    for (const r of registrosOrdenados) {
      const uid = r.usuarioId;
      if (!pontosPorUsuario[uid]) pontosPorUsuario[uid] = [];
      pontosPorUsuario[uid].push({
        tipo: r.tipo,
        dataHora: effDh(r),
      });
    }

    const colaboradorBasico = (u) => ({
      id: u.id,
      nome: u.nome,
      cargo: u.cargo || '',
      departamento: u.departamento || '',
    });

    const listaFerias = (feriasRows || []).map((f) => ({
      ...colaboradorBasico(f.usuario),
      dataInicio: f.dataInicio,
      dataFim: f.dataFim,
      observacao: f.observacao || null,
    }));

    const dispensadosIds = new Set();
    const listaDispensados = [];
    for (const c of comprovantesAprovados || []) {
      if (dispensadosIds.has(c.usuarioId)) continue;
      dispensadosIds.add(c.usuarioId);
      listaDispensados.push({
        ...colaboradorBasico(c.usuario),
        dataReferencia: c.dataReferencia,
        dataFim: c.dataFim,
        descricao: c.descricao || null,
      });
    }

    const listaPresentes = elegiveis.filter((u) => presentes.has(u.id)).map(colaboradorBasico);

    const listaAusentes = [];
    const listaFalta = [];
    const listaAtrasados = [];

    for (const u of elegiveis) {
      if (!esDiaUtil(u.id)) continue;
      if (dispensadosIds.has(u.id)) continue;

      const pontos = pontosPorUsuario[u.id] || [];
      const escalaDia = escalaParaDia(escalasPorUsuario[u.id] || [], diaIso);
      const calc = calcularDia(pontos, { escala: escalaDia, toleranciaMinutos: tol, dataRef: diaIso });
      const temEntrada = Boolean(calc.entrada);

      if (temEntrada && calc.flags?.entradaAtrasada) {
        listaAtrasados.push({
          ...colaboradorBasico(u),
          entradaEm: calc.entrada,
          esperadoEntrada: calc.esperado?.entrada || null,
        });
      }

      const noExpediente = presentes.has(u.id);
      const finalizou = sairam.has(u.id);
      if (!noExpediente && !finalizou) {
        listaAusentes.push({ ...colaboradorBasico(u), esperadoEntrada: calc.esperado?.entrada || null });
        if (!temEntrada && agoraMin > prazoEntradaMin(u.id)) {
          listaFalta.push({ ...colaboradorBasico(u), esperadoEntrada: calc.esperado?.entrada || null });
        }
      }
    }

    const listaPayload = {
      presentes: listaPresentes,
      ausentes: listaAusentes,
      atrasados: listaAtrasados,
      falta: listaFalta,
      ferias: listaFerias,
      dispensados: listaDispensados,
    };

    // Em feriado (suspende expediente), não faz sentido contar presença/ausência.
    if (feriadoHoje) {
      return res.json({
        totalColaboradores,
        presentes: 0,
        ausentes: 0,
        registrosHoje: registrosHoje.length,
        contextoDia: { feriado: { nome: feriadoHoje.nome } },
        listas: {
          presentes: [],
          ausentes: [],
          atrasados: [],
          falta: [],
          ferias: listaFerias,
          dispensados: listaDispensados,
        },
      });
    }

    res.json({
      totalColaboradores,
      presentes: presentes.size,
      ausentes: totalColaboradores - presentes.size - sairam.size,
      registrosHoje: registrosHoje.length,
      listas: listaPayload,
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

    const dhNova = parseDataHoraGerenteInput(dataHoraNova);
    if (!dhNova) return res.status(400).json({ error: 'dataHoraNova inválida' });

    const ajuste = await prisma.ajustePonto.upsert({
      where: { registroId },
      update: { dataHoraNova: dhNova, motivo, adminId },
      create: {
        tenantId,
        registroId,
        adminId,
        dataHoraOriginal: registro.dataHora,
        dataHoraNova: dhNova,
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

    const dh = parseDataHoraGerenteInput(dataHora);
    if (!dh) return res.status(400).json({ error: 'dataHora inválida' });

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
      dataHoraEfetiva != null && String(dataHoraEfetiva).trim() !== ''
        ? parseDataHoraGerenteInput(dataHoraEfetiva)
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
  espelhoMeu,
  espelhoMeuExport,
  fechamentoStatus,
  fechamentoAprovar,
  solicitarAssinaturaEspelho,
  bancoHorasResumo,
  resumoDia,
  ajustarPonto,
  inserirPontoManual,
  listarSolicitacoesAjuste,
  decidirSolicitacaoAjuste,
};
