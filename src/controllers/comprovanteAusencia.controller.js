// src/controllers/comprovanteAusencia.controller.js
const { PrismaClient } = require('@prisma/client');
const { uploadComprovante, gerarUrlAssinada } = require('../services/s3.service');

const prisma = new PrismaClient();

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function bloquearSuperAdmin(req, res) {
  if (req.isSuperAdmin) {
    res.status(403).json({ error: 'Acesse como administrador da empresa (não Super Admin).' });
    return true;
  }
  return false;
}

async function serializar(c, comUrl) {
  const row = {
    id: c.id,
    dataReferencia: c.dataReferencia,
    dataFim: c.dataFim,
    descricao: c.descricao,
    tipoArquivo: c.tipoArquivo,
    status: c.status,
    observacaoAdmin: c.observacaoAdmin,
    respondidoEm: c.respondidoEm,
    createdAt: c.createdAt,
    usuario: c.usuario
      ? { id: c.usuario.id, nome: c.usuario.nome, email: c.usuario.email, cargo: c.usuario.cargo }
      : undefined,
    respondidoPor: c.respondidoPor
      ? { id: c.respondidoPor.id, nome: c.respondidoPor.nome }
      : undefined,
  };
  if (!comUrl) return row;
  if (c.arquivoKey) {
    row.urlVisualizacao = await gerarUrlAssinada(c.arquivoKey, 900);
  } else if (c.arquivoUrl && String(c.arquivoUrl).startsWith('data:')) {
    row.urlVisualizacao = c.arquivoUrl;
  }
  return row;
}

/** Colaborador envia atestado / comprovante */
async function criar(req, res, next) {
  try {
    if (bloquearSuperAdmin(req, res)) return;
    if (req.usuario.role !== 'COLABORADOR') {
      return res.status(403).json({ error: 'Apenas colaboradores podem enviar comprovantes' });
    }

    const { dataReferencia, dataFim, descricao, arquivoBase64, nomeArquivoOriginal } = req.body;

    if (!dataReferencia || !DATA_RE.test(String(dataReferencia))) {
      return res.status(400).json({ error: 'Informe a data da ausência (AAAA-MM-DD)' });
    }
    if (dataFim && !DATA_RE.test(String(dataFim))) {
      return res.status(400).json({ error: 'Data final inválida (AAAA-MM-DD)' });
    }
    if (dataFim && String(dataFim) < String(dataReferencia)) {
      return res.status(400).json({ error: 'A data final não pode ser antes da inicial' });
    }
    if (!arquivoBase64 || typeof arquivoBase64 !== 'string') {
      return res.status(400).json({ error: 'Envie o arquivo (foto ou PDF) em base64' });
    }

    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;

    const up = await uploadComprovante(arquivoBase64, tenantId, usuarioId);
    if (!up.url && !up.key) {
      return res.status(400).json({ error: 'Não foi possível armazenar o arquivo. Configure S3 ou envie um arquivo menor.' });
    }

    const c = await prisma.comprovanteAusencia.create({
      data: {
        tenantId,
        usuarioId,
        dataReferencia: String(dataReferencia),
        dataFim: dataFim ? String(dataFim) : null,
        descricao: descricao ? String(descricao).slice(0, 500) : null,
        tipoArquivo: up.tipoArquivo,
        arquivoKey: up.key,
        arquivoUrl: up.url,
        mimeType: up.mimeType,
        nomeArquivoOriginal: nomeArquivoOriginal ? String(nomeArquivoOriginal).slice(0, 200) : null,
      },
      include: {
        usuario: { select: { id: true, nome: true, email: true, cargo: true } },
      },
    });

    res.status(201).json(await serializar(c, true));
  } catch (err) {
    next(err);
  }
}

/** Lista do próprio colaborador */
async function listarMinhas(req, res, next) {
  try {
    if (bloquearSuperAdmin(req, res)) return;
    if (req.usuario.role !== 'COLABORADOR') {
      return res.status(403).json({ error: 'Apenas colaboradores' });
    }

    const lista = await prisma.comprovanteAusencia.findMany({
      where: { tenantId: req.tenantId, usuarioId: req.usuario.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        usuario: { select: { id: true, nome: true, email: true, cargo: true } },
        respondidoPor: { select: { id: true, nome: true } },
      },
    });

    const out = [];
    for (const c of lista) {
      out.push(await serializar(c, true));
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
}

/** Admin: lista comprovantes da empresa */
async function listar(req, res, next) {
  try {
    if (bloquearSuperAdmin(req, res)) return;
    if (req.usuario.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }

    const status = req.query.status;
    const where = { tenantId: req.tenantId };
    if (status && ['PENDENTE', 'APROVADO', 'REJEITADO'].includes(status)) {
      where.status = status;
    }

    const lista = await prisma.comprovanteAusencia.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        usuario: { select: { id: true, nome: true, email: true, cargo: true } },
        respondidoPor: { select: { id: true, nome: true } },
      },
    });

    const out = [];
    for (const c of lista) {
      out.push(await serializar(c, true));
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
}

/** Detalhe + URL para visualizar arquivo */
async function obter(req, res, next) {
  try {
    if (bloquearSuperAdmin(req, res)) return;

    const c = await prisma.comprovanteAusencia.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: {
        usuario: { select: { id: true, nome: true, email: true, cargo: true } },
        respondidoPor: { select: { id: true, nome: true } },
      },
    });
    if (!c) return res.status(404).json({ error: 'Não encontrado' });

    if (req.usuario.role === 'COLABORADOR' && c.usuarioId !== req.usuario.id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.role === 'COLABORADOR' && c.usuarioId === req.usuario.id) {
      return res.json(await serializar(c, true));
    }
    if (req.usuario.role === 'ADMIN') {
      return res.json(await serializar(c, true));
    }
    return res.status(403).json({ error: 'Acesso negado' });
  } catch (err) {
    next(err);
  }
}

/** Admin aprova ou rejeita */
async function decidir(req, res, next) {
  try {
    if (bloquearSuperAdmin(req, res)) return;
    if (req.usuario.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }

    const { status, observacaoAdmin } = req.body;
    if (!['APROVADO', 'REJEITADO'].includes(status)) {
      return res.status(400).json({ error: 'Status deve ser APROVADO ou REJEITADO' });
    }

    const existente = await prisma.comprovanteAusencia.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existente) return res.status(404).json({ error: 'Não encontrado' });
    if (existente.status !== 'PENDENTE') {
      return res.status(409).json({ error: 'Este comprovante já foi analisado' });
    }

    const c = await prisma.comprovanteAusencia.update({
      where: { id: existente.id },
      data: {
        status,
        observacaoAdmin: observacaoAdmin != null ? String(observacaoAdmin).slice(0, 1000) : null,
        respondidoPorId: req.usuario.id,
        respondidoEm: new Date(),
      },
      include: {
        usuario: { select: { id: true, nome: true, email: true, cargo: true } },
        respondidoPor: { select: { id: true, nome: true } },
      },
    });

    res.json(await serializar(c, true));
  } catch (err) {
    next(err);
  }
}

module.exports = { criar, listarMinhas, listar, obter, decidir };
