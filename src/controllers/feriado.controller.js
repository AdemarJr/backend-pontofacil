// src/controllers/feriado.controller.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function validarDataISO(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
}

async function listar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { de, ate } = req.query || {};
    const where = {
      tenantId,
      ...(de && ate && validarDataISO(de) && validarDataISO(ate) ? { data: { gte: String(de), lte: String(ate) } } : {}),
    };
    const feriados = await prisma.feriado.findMany({
      where,
      orderBy: [{ data: 'asc' }, { nome: 'asc' }],
    });
    return res.json(feriados);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { data, nome, suspendeExpediente } = req.body || {};

    if (!validarDataISO(data)) return res.status(400).json({ error: 'data inválida (use YYYY-MM-DD)' });
    const n = String(nome || '').trim();
    if (!n) return res.status(400).json({ error: 'nome é obrigatório' });

    const item = await prisma.feriado.create({
      data: {
        tenantId,
        data: String(data),
        nome: n,
        suspendeExpediente: suspendeExpediente !== undefined ? Boolean(suspendeExpediente) : true,
      },
    });
    return res.status(201).json(item);
  } catch (err) {
    // unique(tenantId,data)
    if (String(err?.code) === 'P2002') {
      return res.status(409).json({ error: 'Já existe feriado cadastrado para este dia' });
    }
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { data, nome, suspendeExpediente } = req.body || {};

    const upd = {};
    if (data !== undefined) {
      if (!validarDataISO(data)) return res.status(400).json({ error: 'data inválida (use YYYY-MM-DD)' });
      upd.data = String(data);
    }
    if (nome !== undefined) {
      const n = String(nome || '').trim();
      if (!n) return res.status(400).json({ error: 'nome é obrigatório' });
      upd.nome = n;
    }
    if (suspendeExpediente !== undefined) upd.suspendeExpediente = Boolean(suspendeExpediente);

    const result = await prisma.feriado.updateMany({
      where: { id, tenantId },
      data: upd,
    });
    if (result.count === 0) return res.status(404).json({ error: 'Feriado não encontrado' });
    return res.json({ sucesso: true });
  } catch (err) {
    if (String(err?.code) === 'P2002') {
      return res.status(409).json({ error: 'Já existe feriado cadastrado para este dia' });
    }
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;

    const result = await prisma.feriado.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Feriado não encontrado' });
    return res.json({ sucesso: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, criar, atualizar, remover };

