const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DIAS_VALIDOS = [1, 2, 3, 4, 5, 6, 7];

function diaSemanaISO(date = new Date()) {
  const day = new Date(date).getDay();
  return day === 0 ? 7 : day; // domingo=7
}

function validarDiasSemana(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
}

function validarHora(h) {
  return typeof h === 'string' && /^\d{1,2}:\d{2}$/.test(h.trim());
}

async function listar(req, res, next) {
  try {
    const { usuarioId } = req.query;
    if (!usuarioId) return res.status(400).json({ error: 'Informe usuarioId' });
    const u = await prisma.usuario.findFirst({
      where: { id: usuarioId, tenantId: req.tenantId },
    });
    if (!u) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const escalas = await prisma.escala.findMany({
      where: { tenantId: req.tenantId, usuarioId },
      orderBy: [{ ativo: 'desc' }, { updatedAt: 'desc' }],
    });
    res.json(escalas);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const {
      usuarioId,
      nome,
      horaInicio,
      horaFim,
      diasSemana,
      cargaHorariaDiaria,
      intervaloMinutos,
      horaSaidaAlmoco,
      horaRetornoAlmoco,
      ativo,
    } = req.body;

    if (!usuarioId || !nome || !horaInicio || !horaFim || !validarDiasSemana(diasSemana)) {
      return res.status(400).json({
        error: 'usuarioId, nome, horaInicio, horaFim e diasSemana (array 1-7) são obrigatórios',
      });
    }
    if (!validarHora(horaInicio) || !validarHora(horaFim)) {
      return res.status(400).json({ error: 'Horários devem estar no formato HH:mm' });
    }
    if (horaSaidaAlmoco && !validarHora(horaSaidaAlmoco)) {
      return res.status(400).json({ error: 'horaSaidaAlmoco inválida' });
    }
    if (horaRetornoAlmoco && !validarHora(horaRetornoAlmoco)) {
      return res.status(400).json({ error: 'horaRetornoAlmoco inválida' });
    }

    const u = await prisma.usuario.findFirst({
      where: { id: usuarioId, tenantId: req.tenantId, role: 'COLABORADOR' },
    });
    if (!u) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const escala = await prisma.escala.create({
      data: {
        tenantId: req.tenantId,
        usuarioId,
        nome: String(nome).trim(),
        horaInicio: horaInicio.trim(),
        horaFim: horaFim.trim(),
        diasSemana: diasSemana.map((d) => Number(d)),
        cargaHorariaDiaria:
          cargaHorariaDiaria != null ? Number(cargaHorariaDiaria) : 8,
        intervaloMinutos: intervaloMinutos != null ? Number(intervaloMinutos) : 60,
        horaSaidaAlmoco: horaSaidaAlmoco ? horaSaidaAlmoco.trim() : null,
        horaRetornoAlmoco: horaRetornoAlmoco ? horaRetornoAlmoco.trim() : null,
        ativo: ativo !== false,
      },
    });
    res.status(201).json(escala);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const { id } = req.params;
    const {
      nome,
      horaInicio,
      horaFim,
      diasSemana,
      cargaHorariaDiaria,
      intervaloMinutos,
      horaSaidaAlmoco,
      horaRetornoAlmoco,
      ativo,
    } = req.body;

    const existente = await prisma.escala.findFirst({
      where: { id, tenantId: req.tenantId },
    });
    if (!existente) return res.status(404).json({ error: 'Escala não encontrada' });

    const dados = {};
    if (nome !== undefined) dados.nome = String(nome).trim();
    if (horaInicio !== undefined) {
      if (!validarHora(horaInicio)) return res.status(400).json({ error: 'horaInicio inválida' });
      dados.horaInicio = horaInicio.trim();
    }
    if (horaFim !== undefined) {
      if (!validarHora(horaFim)) return res.status(400).json({ error: 'horaFim inválida' });
      dados.horaFim = horaFim.trim();
    }
    if (diasSemana !== undefined) {
      if (!validarDiasSemana(diasSemana)) return res.status(400).json({ error: 'diasSemana inválido' });
      dados.diasSemana = diasSemana.map((d) => Number(d));
    }
    if (cargaHorariaDiaria !== undefined) dados.cargaHorariaDiaria = Number(cargaHorariaDiaria);
    if (intervaloMinutos !== undefined) dados.intervaloMinutos = Number(intervaloMinutos);
    if (horaSaidaAlmoco !== undefined) {
      dados.horaSaidaAlmoco = horaSaidaAlmoco ? String(horaSaidaAlmoco).trim() : null;
    }
    if (horaRetornoAlmoco !== undefined) {
      dados.horaRetornoAlmoco = horaRetornoAlmoco ? String(horaRetornoAlmoco).trim() : null;
    }
    if (ativo !== undefined) dados.ativo = Boolean(ativo);

    const escala = await prisma.escala.update({
      where: { id },
      data: dados,
    });
    res.json(escala);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const { id } = req.params;
    const r = await prisma.escala.deleteMany({
      where: { id, tenantId: req.tenantId },
    });
    if (r.count === 0) return res.status(404).json({ error: 'Escala não encontrada' });
    res.json({ sucesso: true });
  } catch (err) {
    next(err);
  }
}

async function minha(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;

    const dow = diaSemanaISO(new Date());
    const escalas = await prisma.escala.findMany({
      where: { tenantId, usuarioId, ativo: true },
      orderBy: { updatedAt: 'desc' },
    });

    // Preferir uma escala aplicável ao dia da semana; fallback: a mais recente ativa
    const aplicavel = escalas.find((e) => Array.isArray(e.diasSemana) && e.diasSemana.includes(dow)) || escalas[0] || null;

    res.json({
      escala: aplicavel,
      obs: aplicavel
        ? 'Escala ativa (preferindo a aplicável ao dia atual).'
        : 'Nenhuma escala ativa cadastrada para este colaborador.',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, criar, atualizar, remover, minha };
