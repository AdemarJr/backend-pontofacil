// src/controllers/ferias.controller.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function validarDataISO(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
}

function normalizeStatus(s) {
  const v = String(s || '').toUpperCase().trim();
  if (!v) return null;
  if (v !== 'APROVADA' && v !== 'CANCELADA') return null;
  return v;
}

function rangeValido(inicio, fim) {
  if (!validarDataISO(inicio) || !validarDataISO(fim)) return false;
  return String(inicio) <= String(fim);
}

async function listar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { usuarioId, status, de, ate } = req.query || {};
    const st = normalizeStatus(status);

    const where = {
      tenantId,
      ...(usuarioId ? { usuarioId: String(usuarioId) } : {}),
      ...(st ? { status: st } : {}),
      ...(de && ate && validarDataISO(de) && validarDataISO(ate)
        ? {
            AND: [
              { dataInicio: { lte: String(ate) } },
              { dataFim: { gte: String(de) } },
            ],
          }
        : {}),
    };

    const lista = await prisma.ferias.findMany({
      where,
      include: {
        usuario: { select: { id: true, nome: true, email: true, cargo: true, departamento: true } },
      },
      orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return res.json(lista);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { usuarioId, dataInicio, dataFim, status, observacao } = req.body || {};

    if (!usuarioId) return res.status(400).json({ error: 'usuarioId é obrigatório' });
    if (!rangeValido(dataInicio, dataFim)) {
      return res.status(400).json({ error: 'dataInicio/dataFim inválidos (use YYYY-MM-DD; fim >= início)' });
    }

    const alvo = await prisma.usuario.findFirst({
      where: { id: String(usuarioId), tenantId, role: 'COLABORADOR' },
      select: { id: true },
    });
    if (!alvo) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const st = normalizeStatus(status) || 'APROVADA';
    const obs = observacao != null ? String(observacao).trim() : null;

    const item = await prisma.ferias.create({
      data: {
        tenantId,
        usuarioId: String(usuarioId),
        dataInicio: String(dataInicio),
        dataFim: String(dataFim),
        status: st,
        observacao: obs || null,
      },
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
      },
    });
    return res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { dataInicio, dataFim, status, observacao } = req.body || {};

    const upd = {};
    if (dataInicio !== undefined) {
      if (!validarDataISO(dataInicio)) return res.status(400).json({ error: 'dataInicio inválida (use YYYY-MM-DD)' });
      upd.dataInicio = String(dataInicio);
    }
    if (dataFim !== undefined) {
      if (!validarDataISO(dataFim)) return res.status(400).json({ error: 'dataFim inválida (use YYYY-MM-DD)' });
      upd.dataFim = String(dataFim);
    }
    if (upd.dataInicio || upd.dataFim) {
      const atual = await prisma.ferias.findFirst({ where: { id, tenantId }, select: { dataInicio: true, dataFim: true } });
      if (!atual) return res.status(404).json({ error: 'Férias não encontradas' });
      const ini = upd.dataInicio || atual.dataInicio;
      const fim = upd.dataFim || atual.dataFim;
      if (String(ini) > String(fim)) {
        return res.status(400).json({ error: 'dataFim deve ser >= dataInicio' });
      }
    }
    if (status !== undefined) {
      const st = normalizeStatus(status);
      if (!st) return res.status(400).json({ error: 'status inválido (APROVADA|CANCELADA)' });
      upd.status = st;
    }
    if (observacao !== undefined) {
      const obs = observacao == null ? null : String(observacao).trim();
      upd.observacao = obs || null;
    }

    const result = await prisma.ferias.updateMany({
      where: { id, tenantId },
      data: upd,
    });
    if (result.count === 0) return res.status(404).json({ error: 'Férias não encontradas' });
    return res.json({ sucesso: true });
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const result = await prisma.ferias.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Férias não encontradas' });
    return res.json({ sucesso: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, criar, atualizar, remover };

