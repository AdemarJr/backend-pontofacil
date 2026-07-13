// src/controllers/comprovanteAusencia.controller.js
const { PrismaClient } = require('@prisma/client');
const { uploadComprovante, gerarUrlAssinada } = require('../services/s3.service');

const prisma = require('../infra/prisma');

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

/** Admin: lista comprovantes da empresa (sem URL assinada — use GET /:id para abrir arquivo; evita timeout e payload gigante). */
async function listar(req, res, next) {
  try {
    if (bloquearSuperAdmin(req, res)) return;
    if (req.usuario.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }
    if (!req.tenantId) {
      return res.status(403).json({ error: 'Tenant não identificado no token' });
    }

    const status = req.query.status;
    const where = { tenantId: req.tenantId };
    if (status && ['PENDENTE', 'APROVADO', 'REJEITADO'].includes(String(status))) {
      where.status = String(status);
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
      out.push(await serializar(c, false));
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

/**
 * Marcadores manuais (criados pelo gestor, sem documento anexado). São os únicos
 * tipos que podem ser removidos pela rota de remoção — atestados reais (com arquivo)
 * nunca são apagados por aqui.
 */
const TIPOS_MANUAIS = ['FOLGA', 'JUSTIFICATIVA'];

function ehMarcadorManual(registro) {
  if (!registro) return false;
  const temArquivo = !!registro.arquivoKey || !!registro.arquivoUrl;
  return TIPOS_MANUAIS.includes(registro.tipoArquivo) && !temArquivo;
}

/**
 * Admin: registra uma FOLGA ou uma JUSTIFICATIVA (falta justificada) sem documento.
 * Reaproveita a tabela de comprovantes marcando tipoArquivo = 'FOLGA' | 'JUSTIFICATIVA'
 * e status APROVADO, para que o espelho trate o(s) dia(s) como folga/justificada
 * (esperado 0) em vez de falta.
 */
async function registrarFolga(req, res, next) {
  try {
    if (bloquearSuperAdmin(req, res)) return;
    if (req.usuario.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }

    const { usuarioId, dataReferencia, dataFim, descricao, tipo } = req.body || {};

    const tipoMarcador = String(tipo).toUpperCase() === 'JUSTIFICATIVA' ? 'JUSTIFICATIVA' : 'FOLGA';

    if (!usuarioId) {
      return res.status(400).json({ error: 'Informe o colaborador (usuarioId)' });
    }
    if (!dataReferencia || !DATA_RE.test(String(dataReferencia))) {
      return res.status(400).json({ error: 'Informe a data (AAAA-MM-DD)' });
    }
    if (dataFim && !DATA_RE.test(String(dataFim))) {
      return res.status(400).json({ error: 'Data final inválida (AAAA-MM-DD)' });
    }
    if (dataFim && String(dataFim) < String(dataReferencia)) {
      return res.status(400).json({ error: 'A data final não pode ser antes da inicial' });
    }
    // Justificar uma falta exige um motivo; folga é dispensa e o motivo é opcional.
    if (tipoMarcador === 'JUSTIFICATIVA' && !String(descricao || '').trim()) {
      return res.status(400).json({ error: 'Informe o motivo da justificativa' });
    }

    const tenantId = req.tenantId;

    const colab = await prisma.usuario.findFirst({
      where: { id: String(usuarioId), tenantId, role: 'COLABORADOR' },
      select: { id: true },
    });
    if (!colab) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const descricaoPadrao =
      tipoMarcador === 'JUSTIFICATIVA' ? 'Falta justificada pelo gestor' : 'Folga registrada pelo gestor';

    const c = await prisma.comprovanteAusencia.create({
      data: {
        tenantId,
        usuarioId: colab.id,
        dataReferencia: String(dataReferencia),
        dataFim: dataFim ? String(dataFim) : null,
        descricao: descricao ? String(descricao).slice(0, 500) : descricaoPadrao,
        tipoArquivo: tipoMarcador,
        status: 'APROVADO',
        respondidoPorId: req.usuario.id,
        respondidoEm: new Date(),
      },
      include: {
        usuario: { select: { id: true, nome: true, email: true, cargo: true } },
        respondidoPor: { select: { id: true, nome: true } },
      },
    });

    res.status(201).json(await serializar(c, false));
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: altera um marcador manual (data, tipo folga/justificativa ou motivo).
 */
async function atualizarFolga(req, res, next) {
  try {
    if (bloquearSuperAdmin(req, res)) return;
    if (req.usuario.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }

    const { dataReferencia, dataFim, descricao, tipo } = req.body || {};

    const existente = await prisma.comprovanteAusencia.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      select: {
        id: true,
        usuarioId: true,
        tipoArquivo: true,
        arquivoKey: true,
        arquivoUrl: true,
        dataReferencia: true,
        dataFim: true,
        descricao: true,
      },
    });
    if (!existente) return res.status(404).json({ error: 'Não encontrado' });
    if (!ehMarcadorManual(existente)) {
      return res.status(400).json({ error: 'Este registro é um atestado/comprovante e não pode ser alterado por aqui.' });
    }

    const dados = {};
    if (dataReferencia !== undefined) {
      if (!DATA_RE.test(String(dataReferencia))) {
        return res.status(400).json({ error: 'Informe a data (AAAA-MM-DD)' });
      }
      dados.dataReferencia = String(dataReferencia);
    }
    if (dataFim !== undefined) {
      if (dataFim === null || dataFim === '') {
        dados.dataFim = null;
      } else {
        if (!DATA_RE.test(String(dataFim))) {
          return res.status(400).json({ error: 'Data final inválida (AAAA-MM-DD)' });
        }
        dados.dataFim = String(dataFim);
      }
    }
    if (tipo !== undefined) {
      dados.tipoArquivo = String(tipo).toUpperCase() === 'JUSTIFICATIVA' ? 'JUSTIFICATIVA' : 'FOLGA';
    }
    if (descricao !== undefined) {
      dados.descricao = descricao ? String(descricao).slice(0, 500) : null;
    }

    const dataIni = dados.dataReferencia ?? existente.dataReferencia;
    const dataFinal = dados.dataFim !== undefined ? dados.dataFim : existente.dataFim ?? dataIni;
    if (dataFinal && String(dataFinal) < String(dataIni)) {
      return res.status(400).json({ error: 'A data final não pode ser antes da inicial' });
    }
    if (dataFim === undefined && !existente.dataFim && dados.dataReferencia) {
      dados.dataFim = dados.dataReferencia;
    }

    const tipoFinal = dados.tipoArquivo ?? existente.tipoArquivo;
    const descricaoFinal =
      dados.descricao !== undefined ? dados.descricao : existente.descricao;
    if (tipoFinal === 'JUSTIFICATIVA' && !String(descricaoFinal || '').trim()) {
      return res.status(400).json({ error: 'Informe o motivo da justificativa' });
    }
    if (tipoFinal === 'FOLGA' && dados.descricao === undefined && !descricaoFinal) {
      dados.descricao = 'Folga registrada pelo gestor';
    }
    if (tipoFinal === 'JUSTIFICATIVA' && dados.descricao === undefined && !descricaoFinal) {
      dados.descricao = 'Falta justificada pelo gestor';
    }

    if (dados.dataReferencia && dados.dataReferencia !== existente.dataReferencia) {
      const conflito = await prisma.comprovanteAusencia.findFirst({
        where: {
          tenantId: req.tenantId,
          usuarioId: existente.usuarioId,
          id: { not: existente.id },
          dataReferencia: dados.dataReferencia,
          tipoArquivo: { in: TIPOS_MANUAIS },
          arquivoKey: null,
          arquivoUrl: null,
        },
        select: { id: true },
      });
      if (conflito) {
        return res.status(409).json({ error: 'Já existe uma folga ou justificativa manual nesta data.' });
      }
    }

    const c = await prisma.comprovanteAusencia.update({
      where: { id: existente.id },
      data: {
        ...dados,
        respondidoPorId: req.usuario.id,
        respondidoEm: new Date(),
      },
      include: {
        usuario: { select: { id: true, nome: true, email: true, cargo: true } },
        respondidoPor: { select: { id: true, nome: true } },
      },
    });

    res.json(await serializar(c, false));
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: remove um marcador manual (FOLGA ou JUSTIFICATIVA) criado pelo gestor.
 * Nunca exclui atestados/comprovantes reais (com arquivo anexado).
 */
async function removerFolga(req, res, next) {
  try {
    if (bloquearSuperAdmin(req, res)) return;
    if (req.usuario.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }

    const existente = await prisma.comprovanteAusencia.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      select: { id: true, tipoArquivo: true, arquivoKey: true, arquivoUrl: true },
    });
    if (!existente) return res.status(404).json({ error: 'Não encontrado' });
    if (!ehMarcadorManual(existente)) {
      return res.status(400).json({ error: 'Este registro é um atestado/comprovante e não pode ser removido por aqui.' });
    }

    await prisma.comprovanteAusencia.delete({ where: { id: existente.id } });
    res.json({ sucesso: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { criar, listarMinhas, listar, obter, decidir, registrarFolga, atualizarFolga, removerFolga };
