const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function listar(req, res, next) {
  try {
    const locais = await prisma.localRegistro.findMany({
      where: { tenantId: req.tenantId },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
    res.json(locais);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { nome, latitude, longitude, raioMetros, ativo, ordem } = req.body;
    if (!nome || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'nome, latitude e longitude são obrigatórios' });
    }
    const local = await prisma.localRegistro.create({
      data: {
        tenantId: req.tenantId,
        nome: String(nome).trim(),
        latitude: Number(latitude),
        longitude: Number(longitude),
        raioMetros: raioMetros != null ? Number(raioMetros) : 200,
        ativo: ativo !== false,
        ordem: ordem != null ? Number(ordem) : 0,
      },
    });
    res.status(201).json(local);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const { id } = req.params;
    const { nome, latitude, longitude, raioMetros, ativo, ordem } = req.body;

    const existente = await prisma.localRegistro.findFirst({
      where: { id, tenantId: req.tenantId },
    });
    if (!existente) return res.status(404).json({ error: 'Local não encontrado' });

    const dados = {};
    if (nome !== undefined) dados.nome = String(nome).trim();
    if (latitude !== undefined) dados.latitude = Number(latitude);
    if (longitude !== undefined) dados.longitude = Number(longitude);
    if (raioMetros !== undefined) dados.raioMetros = Number(raioMetros);
    if (ativo !== undefined) dados.ativo = Boolean(ativo);
    if (ordem !== undefined) dados.ordem = Number(ordem);

    const local = await prisma.localRegistro.update({ where: { id }, data: dados });
    res.json(local);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.usuario.updateMany({
      where: { tenantId: req.tenantId, localRegistroId: id },
      data: { localRegistroId: null },
    });
    const r = await prisma.localRegistro.deleteMany({
      where: { id, tenantId: req.tenantId },
    });
    if (r.count === 0) return res.status(404).json({ error: 'Local não encontrado' });
    res.json({ sucesso: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, criar, atualizar, remover };
