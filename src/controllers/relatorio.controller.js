// src/controllers/relatorio.controller.js
const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const prisma = new PrismaClient();

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDateISO(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function fmtTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}
function minutesBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 1000 / 60);
}
function fmtHours(min) {
  const sign = min < 0 ? '-' : '';
  const v = Math.abs(min);
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${sign}${pad2(h)}:${pad2(m)}`;
}

/**
 * Regras trabalhistas básicas (ajustáveis no futuro):
 * - jornada diária padrão: 8h (480 min)
 * - intervalo mínimo (almoço): 60 min quando houver saída/retorno
 * - flags: marcação incompleta, intervalo insuficiente, jornada excedida
 */
function calcularDia(pontos) {
  // Ordena por dataHora
  const sorted = [...pontos].sort((a, b) => new Date(a.dataHora) - new Date(b.dataHora));

  const getTipo = (t) => String(t || '').toUpperCase();
  const byTipo = (tipo) => sorted.find((p) => getTipo(p.tipo) === tipo) || null;

  const entrada = byTipo('ENTRADA');
  const saidaAlmoco = byTipo('SAIDA_ALMOCO');
  const retornoAlmoco = byTipo('RETORNO_ALMOCO');
  const saida = byTipo('SAIDA');

  const intervaloMin = (saidaAlmoco && retornoAlmoco) ? minutesBetween(saidaAlmoco.dataHora, retornoAlmoco.dataHora) : null;

  // minutos trabalhados: (ENTRADA->SAIDA_ALMOCO) + (RETORNO_ALMOCO->SAIDA) quando existirem
  let minutosTrabalhados = 0;
  if (entrada && saidaAlmoco) minutosTrabalhados += minutesBetween(entrada.dataHora, saidaAlmoco.dataHora);
  if (retornoAlmoco && saida) minutosTrabalhados += minutesBetween(retornoAlmoco.dataHora, saida.dataHora);

  // fallback simples: se não tem almoço, tenta ENTRADA->SAIDA
  if (minutosTrabalhados === 0 && entrada && saida) {
    minutosTrabalhados = minutesBetween(entrada.dataHora, saida.dataHora);
  }

  const jornadaPadraoMin = 8 * 60;
  const extrasMin = Math.max(0, minutosTrabalhados - jornadaPadraoMin);

  const faltandoMarcacao =
    !entrada || !saida || (Boolean(saidaAlmoco) !== Boolean(retornoAlmoco)); // almoço incompleto conta como inconsistente

  const intervaloInsuficiente = intervaloMin != null && intervaloMin < 60;
  const jornadaExcedida = minutosTrabalhados > jornadaPadraoMin;

  return {
    entrada: entrada?.dataHora ?? null,
    saidaAlmoco: saidaAlmoco?.dataHora ?? null,
    retornoAlmoco: retornoAlmoco?.dataHora ?? null,
    saida: saida?.dataHora ?? null,
    intervaloMin,
    minutosTrabalhados,
    extrasMin,
    flags: {
      faltandoMarcacao,
      intervaloInsuficiente,
      jornadaExcedida,
    },
  };
}

// Espelho de ponto mensal por colaborador
async function espelhoPonto(req, res, next) {
  try {
    const { usuarioId, mes, ano } = req.query;
    const tenantId = req.tenantId;

    const mesNum = parseInt(mes) || new Date().getMonth() + 1;
    const anoNum = parseInt(ano) || new Date().getFullYear();
    const dataInicio = new Date(anoNum, mesNum - 1, 1);
    const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59);

    const registros = await prisma.registroPonto.findMany({
      where: {
        tenantId,
        ...(usuarioId && { usuarioId }),
        dataHora: { gte: dataInicio, lte: dataFim },
      },
      include: {
        usuario: { select: { nome: true, cargo: true, departamento: true } },
        ajuste: true,
      },
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    // Agrupa por usuário e por dia
    const porUsuario = {};
    for (const r of registros) {
      const uid = r.usuarioId;
      if (!porUsuario[uid]) {
        porUsuario[uid] = {
          usuario: r.usuario,
          diasTrabalhados: {},
          totalHoras: 0,
          totalExtras: 0,
        };
      }

      const dia = r.dataHora.toISOString().split('T')[0];
      if (!porUsuario[uid].diasTrabalhados[dia]) {
        porUsuario[uid].diasTrabalhados[dia] = [];
      }
      porUsuario[uid].diasTrabalhados[dia].push({
        id: r.id,
        tipo: r.tipo,
        dataHora: r.ajuste ? r.ajuste.dataHoraNova : r.dataHora,
        fotoUrl: r.fotoUrl,
        ajustado: !!r.ajuste,
        motivoAjuste: r.ajuste?.motivo,
      });
    }

    // Calcula horas trabalhadas por dia
    for (const uid in porUsuario) {
      let totalMinutos = 0;
      let totalExtras = 0;
      for (const dia in porUsuario[uid].diasTrabalhados) {
        const pontos = porUsuario[uid].diasTrabalhados[dia];
        const calc = calcularDia(pontos);
        const minutos = calc.minutosTrabalhados;
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
          flags: calc.flags,
        };
        totalMinutos += minutos;
        totalExtras += calc.extrasMin;
      }
      porUsuario[uid].totalHoras = fmtHours(totalMinutos);
      porUsuario[uid].totalExtras = fmtHours(totalExtras);
    }

    res.json({
      periodo: { mes: mesNum, ano: anoNum },
      relatorio: Object.values(porUsuario),
    });
  } catch (err) { next(err); }
}

function buildEspelhoRows(relatorio, periodo) {
  const rows = [];
  for (const item of relatorio) {
    const dias = item.diasTrabalhados || {};
    for (const dia of Object.keys(dias).sort()) {
      const d = dias[dia];
      rows.push({
        periodo: `${pad2(periodo.mes)}/${periodo.ano}`,
        dia,
        nome: item.usuario?.nome ?? '',
        cargo: item.usuario?.cargo ?? '',
        departamento: item.usuario?.departamento ?? '',
        entrada: d.marcacoes?.entrada ?? '',
        saidaAlmoco: d.marcacoes?.saidaAlmoco ?? '',
        retornoAlmoco: d.marcacoes?.retornoAlmoco ?? '',
        saida: d.marcacoes?.saida ?? '',
        intervalo: d.intervalo ?? '',
        horasTrabalhadas: d.horasTrabalhadas ?? '',
        extras: d.extras ?? '',
        faltandoMarcacao: d.flags?.faltandoMarcacao ? 'SIM' : 'NAO',
        intervaloInsuficiente: d.flags?.intervaloInsuficiente ? 'SIM' : 'NAO',
        jornadaExcedida: d.flags?.jornadaExcedida ? 'SIM' : 'NAO',
      });
    }
  }
  return rows;
}

function rowsToCsv(rows) {
  const headers = [
    'periodo','dia','nome','cargo','departamento',
    'entrada','saidaAlmoco','retornoAlmoco','saida',
    'intervalo','horasTrabalhadas','extras',
    'faltandoMarcacao','intervaloInsuficiente','jornadaExcedida'
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
      where: {
        tenantId,
        ...(usuarioId && { usuarioId }),
        dataHora: { gte: dataInicio, lte: dataFim },
      },
      include: {
        usuario: { select: { nome: true, cargo: true, departamento: true } },
        ajuste: true,
      },
      orderBy: [{ usuarioId: 'asc' }, { dataHora: 'asc' }],
    });

    // reaproveita o agrupamento do espelho (mesma estrutura)
    const porUsuario = {};
    for (const r of registros) {
      const uid = r.usuarioId;
      if (!porUsuario[uid]) {
        porUsuario[uid] = { usuario: r.usuario, diasTrabalhados: {}, totalHoras: 0, totalExtras: 0 };
      }
      const dia = fmtDateISO(r.dataHora);
      if (!porUsuario[uid].diasTrabalhados[dia]) porUsuario[uid].diasTrabalhados[dia] = [];
      porUsuario[uid].diasTrabalhados[dia].push({
        id: r.id,
        tipo: r.tipo,
        dataHora: r.ajuste ? r.ajuste.dataHoraNova : r.dataHora,
        fotoUrl: r.fotoUrl,
        ajustado: !!r.ajuste,
        motivoAjuste: r.ajuste?.motivo,
      });
    }

    for (const uid in porUsuario) {
      let totalMinutos = 0;
      let totalExtras = 0;
      for (const dia in porUsuario[uid].diasTrabalhados) {
        const pontos = porUsuario[uid].diasTrabalhados[dia];
        const calc = calcularDia(pontos);
        const minutos = calc.minutosTrabalhados;
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
          flags: calc.flags,
        };
        totalMinutos += minutos;
        totalExtras += calc.extrasMin;
      }
      porUsuario[uid].totalHoras = fmtHours(totalMinutos);
      porUsuario[uid].totalExtras = fmtHours(totalExtras);
    }

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
        { header: 'Saída Almoço', key: 'saidaAlmoco', width: 12 },
        { header: 'Retorno Almoço', key: 'retornoAlmoco', width: 13 },
        { header: 'Saída', key: 'saida', width: 10 },
        { header: 'Intervalo', key: 'intervalo', width: 10 },
        { header: 'Horas', key: 'horasTrabalhadas', width: 10 },
        { header: 'Extras', key: 'extras', width: 10 },
        { header: 'Faltando marcação', key: 'faltandoMarcacao', width: 16 },
        { header: 'Intervalo insuficiente', key: 'intervaloInsuficiente', width: 18 },
        { header: 'Jornada excedida', key: 'jornadaExcedida', width: 14 },
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

      const headers = ['Dia', 'Nome', 'Entrada', 'Saída', 'Intervalo', 'Horas', 'Extras', 'Flags'];
      const colW = [52, 160, 52, 52, 60, 52, 52, 70];
      const startX = doc.x;
      let y = doc.y;

      function rowLine(vals, bold) {
        let x = startX;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        for (let i = 0; i < vals.length; i++) {
          doc.text(String(vals[i] ?? ''), x, y, { width: colW[i], ellipsis: true });
          x += colW[i];
        }
        y += 12;
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
        rowLine([r.dia, r.nome, r.entrada, r.saida, r.intervalo, r.horasTrabalhadas, r.extras, flags.join(',')], false);
      }
      doc.end();
      return;
    }

    // default CSV
    const csv = rowsToCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    return res.send(csv);
  } catch (err) { next(err); }
}

// Resumo do dia para o dashboard
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
      if (r.tipo === 'SAIDA') { presentes.delete(r.usuarioId); ausentes.add(r.usuarioId); }
    }

    res.json({
      totalColaboradores,
      presentes: presentes.size,
      ausentes: totalColaboradores - presentes.size - ausentes.size,
      registrosHoje: registrosHoje.length,
    });
  } catch (err) { next(err); }
}

// Ajuste manual de ponto
async function ajustarPonto(req, res, next) {
  try {
    const { registroId, dataHoraNova, motivo } = req.body;
    const tenantId = req.tenantId;
    const adminId = req.usuario.id;

    if (!registroId || !dataHoraNova || !motivo) {
      return res.status(400).json({ error: 'registroId, dataHoraNova e motivo são obrigatórios' });
    }

    const registro = await prisma.registroPonto.findFirst({
      where: { id: registroId, tenantId }
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
  } catch (err) { next(err); }
}

module.exports = { espelhoPonto, espelhoExport, resumoDia, ajustarPonto };
