// CRUD de planos comerciais (Super Admin)
const prisma = require('../infra/prisma');

function parseValorCentavos(body) {
  if (body.valorCentavos != null && body.valorCentavos !== '') {
    const n = parseInt(body.valorCentavos, 10);
    if (!Number.isFinite(n) || n < 0) return { erro: 'Valor do plano inválido' };
    return { valorCentavos: n };
  }
  if (body.valorReais != null && body.valorReais !== '') {
    const reais = Number(String(body.valorReais).replace(',', '.'));
    if (!Number.isFinite(reais) || reais < 0) return { erro: 'Valor do plano inválido' };
    return { valorCentavos: Math.round(reais * 100) };
  }
  return { erro: 'Informe valorCentavos ou valorReais' };
}

function parseMaxColaboradores(body) {
  if (body.maxColaboradores === '' || body.maxColaboradores === null || body.maxColaboradores === undefined) {
    return { maxColaboradores: null };
  }
  const n = parseInt(body.maxColaboradores, 10);
  if (!Number.isFinite(n) || n < 1) return { erro: 'Quantidade de colaboradores deve ser >= 1 ou vazio (ilimitado)' };
  return { maxColaboradores: n };
}

async function listar(req, res, next) {
  try {
    const apenasAtivos = req.query.ativos === '1' || req.query.ativos === 'true';
    const planos = await prisma.planoComercial.findMany({
      where: apenasAtivos ? { ativo: true } : undefined,
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: { _count: { select: { tenants: true } } },
    });
    res.json(planos);
  } catch (err) {
    next(err);
  }
}

async function buscarPorId(req, res, next) {
  try {
    const plano = await prisma.planoComercial.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { tenants: true } } },
    });
    if (!plano) return res.status(404).json({ error: 'Plano não encontrado' });
    res.json(plano);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { nome, descricao, ordem, ativo } = req.body;
    if (!nome || !String(nome).trim()) {
      return res.status(400).json({ error: 'Nome do plano é obrigatório' });
    }
    const valor = parseValorCentavos(req.body);
    if (valor.erro) return res.status(400).json({ error: valor.erro });
    const max = parseMaxColaboradores(req.body);
    if (max.erro) return res.status(400).json({ error: max.erro });

    const plano = await prisma.planoComercial.create({
      data: {
        nome: String(nome).trim(),
        descricao: descricao ? String(descricao).trim() : null,
        valorCentavos: valor.valorCentavos,
        maxColaboradores: max.maxColaboradores,
        ordem: ordem != null ? parseInt(ordem, 10) || 0 : 0,
        ativo: ativo !== false && ativo !== 'false',
      },
    });
    res.status(201).json(plano);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const { id } = req.params;
    const existente = await prisma.planoComercial.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Plano não encontrado' });

    const data = {};
    if (req.body.nome !== undefined) {
      if (!String(req.body.nome).trim()) return res.status(400).json({ error: 'Nome do plano é obrigatório' });
      data.nome = String(req.body.nome).trim();
    }
    if (req.body.descricao !== undefined) {
      data.descricao = req.body.descricao ? String(req.body.descricao).trim() : null;
    }
    if (req.body.valorCentavos !== undefined || req.body.valorReais !== undefined) {
      const valor = parseValorCentavos(req.body);
      if (valor.erro) return res.status(400).json({ error: valor.erro });
      data.valorCentavos = valor.valorCentavos;
    }
    if (req.body.maxColaboradores !== undefined) {
      const max = parseMaxColaboradores(req.body);
      if (max.erro) return res.status(400).json({ error: max.erro });
      data.maxColaboradores = max.maxColaboradores;
    }
    if (req.body.ordem !== undefined) data.ordem = parseInt(req.body.ordem, 10) || 0;
    if (req.body.ativo !== undefined) data.ativo = req.body.ativo === true || req.body.ativo === 'true';

    const plano = await prisma.planoComercial.update({ where: { id }, data });
    res.json(plano);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const { id } = req.params;
    const plano = await prisma.planoComercial.findUnique({
      where: { id },
      include: { _count: { select: { tenants: true } } },
    });
    if (!plano) return res.status(404).json({ error: 'Plano não encontrado' });

    if (plano._count.tenants > 0) {
      await prisma.planoComercial.update({ where: { id }, data: { ativo: false } });
      return res.json({
        desativado: true,
        mensagem: 'Plano possui empresas vinculadas — foi desativado em vez de excluído.',
      });
    }

    await prisma.planoComercial.delete({ where: { id } });
    res.json({ removido: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, buscarPorId, criar, atualizar, remover };
