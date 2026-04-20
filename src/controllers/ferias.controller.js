// src/controllers/ferias.controller.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function validarDataISO(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
}

function normalizeStatus(s) {
  const v = String(s || '').toUpperCase().trim();
  if (!v) return null;
  const ok = ['PENDENTE', 'APROVADA', 'REJEITADA', 'CANCELADA'];
  if (!ok.includes(v)) return null;
  return v;
}

function rangeValido(inicio, fim) {
  if (!validarDataISO(inicio) || !validarDataISO(fim)) return false;
  return String(inicio) <= String(fim);
}

/** Admin: total de solicitações aguardando decisão (badge no menu) */
async function contarPendentes(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const count = await prisma.ferias.count({
      where: { tenantId, status: 'PENDENTE' },
    });
    return res.json({ count });
  } catch (err) {
    next(err);
  }
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
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    return res.json(lista);
  } catch (err) {
    next(err);
  }
}

/** Colaborador: apenas os próprios períodos */
async function listarMinhas(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;
    const lista = await prisma.ferias.findMany({
      where: { tenantId, usuarioId },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    return res.json(lista);
  } catch (err) {
    next(err);
  }
}

/** Colaborador: solicita férias (fica PENDENTE até o gestor decidir) */
async function solicitar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;
    const { dataInicio, dataFim, observacao } = req.body || {};

    if (!rangeValido(dataInicio, dataFim)) {
      return res.status(400).json({ error: 'dataInicio/dataFim inválidos (use YYYY-MM-DD; fim >= início)' });
    }

    const alvo = await prisma.usuario.findFirst({
      where: { id: usuarioId, tenantId, role: 'COLABORADOR', ativo: true },
      select: { id: true },
    });
    if (!alvo) return res.status(403).json({ error: 'Apenas colaboradores ativos podem solicitar férias' });

    const obs = observacao != null ? String(observacao).trim() : null;

    const item = await prisma.ferias.create({
      data: {
        tenantId,
        usuarioId,
        dataInicio: String(dataInicio),
        dataFim: String(dataFim),
        status: 'PENDENTE',
        observacao: obs || null,
      },
    });
    return res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

/** Admin: lança férias (normalmente já APROVADAS) ou outro status explícito */
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
        ...(st === 'APROVADA' ? { respondidoEm: new Date() } : {}),
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

/** Admin: aprovar ou rejeitar solicitação PENDENTE */
async function decidir(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { acao, respostaAdmin } = req.body || {};
    const a = String(acao || '').toUpperCase().trim();

    if (a !== 'APROVAR' && a !== 'REJEITAR') {
      return res.status(400).json({ error: 'acao deve ser APROVAR ou REJEITAR' });
    }

    const reg = await prisma.ferias.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!reg) return res.status(404).json({ error: 'Solicitação não encontrada' });
    if (reg.status !== 'PENDENTE') {
      return res.status(409).json({ error: 'Somente solicitações pendentes podem ser decididas' });
    }

    const msg = respostaAdmin != null ? String(respostaAdmin).trim() : '';

    await prisma.ferias.update({
      where: { id },
      data: {
        status: a === 'APROVAR' ? 'APROVADA' : 'REJEITADA',
        respostaAdmin: msg || null,
        respondidoEm: new Date(),
      },
    });

    return res.json({ sucesso: true });
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
      if (!st) return res.status(400).json({ error: 'status inválido' });
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

module.exports = { contarPendentes, listar, listarMinhas, solicitar, criar, decidir, atualizar, remover };
