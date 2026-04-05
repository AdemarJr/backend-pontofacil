// src/controllers/relatorio.controller.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

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
      for (const dia in porUsuario[uid].diasTrabalhados) {
        const pontos = porUsuario[uid].diasTrabalhados[dia];
        const minutos = calcularMinutosTrabalhados(pontos);
        porUsuario[uid].diasTrabalhados[dia] = {
          pontos,
          minutosTrabalhados: minutos,
          horasTrabalhadas: (minutos / 60).toFixed(2),
        };
        totalMinutos += minutos;
      }
      porUsuario[uid].totalHoras = (totalMinutos / 60).toFixed(2);
      porUsuario[uid].totalExtras = Math.max(0, ((totalMinutos - (22 * 8 * 60)) / 60)).toFixed(2);
    }

    res.json({
      periodo: { mes: mesNum, ano: anoNum },
      relatorio: Object.values(porUsuario),
    });
  } catch (err) { next(err); }
}

function calcularMinutosTrabalhados(pontos) {
  let entrada = null;
  let total = 0;
  for (const p of pontos) {
    if (p.tipo === 'ENTRADA' || p.tipo === 'RETORNO_ALMOCO') {
      entrada = new Date(p.dataHora);
    } else if ((p.tipo === 'SAIDA_ALMOCO' || p.tipo === 'SAIDA') && entrada) {
      total += (new Date(p.dataHora) - entrada) / 1000 / 60;
      entrada = null;
    }
  }
  return Math.round(total);
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

module.exports = { espelhoPonto, resumoDia, ajustarPonto };
