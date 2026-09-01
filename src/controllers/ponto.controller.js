// src/controllers/ponto.controller.js
const { uploadFoto, gerarUrlAssinada } = require('../services/s3.service');
const { validarGeofence, validarEmAlgumLocal } = require('../utils/geofence');
const { calcularDia, pad2, agruparPontosPorDiaJornada } = require('../utils/espelhoCalculo');
const { createTimezoneHelper } = require('../utils/timezoneBr');
const crypto = require('crypto');

const prisma = require('../infra/prisma');
const { criarRegistroPonto } = require('../modules/ponto/registroPonto.service');
const {
  determinarProximoTipo,
  tiposPermitidosRegistro,
  ultimoTipoFechaCiclo,
  turnoAbertoContinua,
  resolverProximoTipo,
  LIMITE_TURNO_ABERTO_HORAS,
} = require('../modules/ponto/sequenciaMarcacao');
const { usuarioTemDocumento } = require('../shared/documentoIdentificacao');
const { registrarAuditoria, ipHashFromReq } = require('../shared/auditoria.service');
const { CONSENTIMENTO_VERSAO_ATUAL } = require('../shared/consentimento');
const { gerarComprovantePdfStream, urlComprovante } = require('../modules/ponto/comprovanteRegistro.service');

const LIMITE_PENDENCIA_MODAL_HORAS = 12;
const LIMITE_TURNO_MAX_HORAS = LIMITE_TURNO_ABERTO_HORAS;
const COOLDOWN_BATIDA_SEGUNDOS = 15;

const DEFAULT_MIN_TRABALHO_ANTES_SAIDA_MIN = 30;
const DEFAULT_MIN_INTERVALO_ALMOCO_MIN = 30;

function diffHoras(a, b) {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / (1000 * 60 * 60);
}

function diffMinutos(a, b) {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / (1000 * 60);
}

function diffSegundos(a, b) {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / 1000;
}

function registroResponse(registro, proximoTipo) {
  return {
    id: registro.id,
    nsr: registro.nsr,
    tipo: registro.tipo,
    dataHora: registro.dataHora,
    usuario: registro.usuario?.nome,
    comprovanteUrl: urlComprovante(registro.id),
    proximoTipo,
  };
}

async function pendenciasColaborador(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;
    const dias = Math.min(60, Math.max(1, parseInt(req.query.dias || '14', 10)));

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { modoMarcacao: true, fusoHorario: true },
    });
    const modoMarcacao = tenant?.modoMarcacao || 'QUATRO_BATIDAS';
    const tz = createTimezoneHelper(tenant?.fusoHorario);

    const agora = new Date();
    const { inicio: inicioJanela } = tz.inicioFimDoDia(new Date(agora.getTime() - (dias - 1) * 24 * 60 * 60 * 1000));

    const registros = await prisma.registroPonto.findMany({
      where: { tenantId, usuarioId, deletedAt: null, dataHora: { gte: inicioJanela, lte: agora } },
      include: { ajuste: true },
      orderBy: { dataHora: 'asc' },
    });

    const pontosFlat = registros.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      dataHora: r.ajuste?.dataHoraNova || r.dataHora,
    }));
    const porDia = agruparPontosPorDiaJornada(pontosFlat, {
      limiteHorasTurno: LIMITE_TURNO_MAX_HORAS,
      timeZone: tz.timeZone,
    });

    const pendencias = [];
    for (const [dia, pontos] of Object.entries(porDia)) {
      const calc = calcularDia(pontos, { dataRef: dia, modoMarcacao, timeZone: tz.timeZone });
      if (!calc.flags?.faltandoMarcacao) continue;

      const missing = [];
      if (!calc.entrada) missing.push('ENTRADA');
      if (!calc.saida) missing.push('SAIDA');
      if (modoMarcacao !== 'DUAS_BATIDAS') {
        const temSaidaAlmoco = Boolean(calc.saidaAlmoco);
        const temRetorno = Boolean(calc.retornoAlmoco);
        if (temSaidaAlmoco !== temRetorno) {
          if (!temSaidaAlmoco) missing.push('SAIDA_ALMOCO');
          if (!temRetorno) missing.push('RETORNO_ALMOCO');
        }
      }

      pendencias.push({
        dia,
        faltando: missing,
        minutosTrabalhados: calc.minutosTrabalhados,
        marcacoes: {
          entrada: calc.entrada,
          saidaAlmoco: calc.saidaAlmoco,
          retornoAlmoco: calc.retornoAlmoco,
          saida: calc.saida,
        },
      });
    }

    pendencias.sort((a, b) => (a.dia < b.dia ? 1 : -1));
    res.json({ dias, pendencias, modoMarcacao });
  } catch (err) {
    next(err);
  }
}

async function solicitarAjusteColaborador(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;
    const { dia, tipo, dataHoraSugerida, justificativa } = req.body || {};

    if (!dia || !tipo || !justificativa) {
      return res.status(400).json({ error: 'dia, tipo e justificativa são obrigatórios' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia))) {
      return res.status(400).json({ error: 'dia inválido (use YYYY-MM-DD)' });
    }
    const tiposValidos = ['ENTRADA', 'SAIDA_ALMOCO', 'RETORNO_ALMOCO', 'SAIDA'];
    const tipoUp = String(tipo).toUpperCase();
    if (!tiposValidos.includes(tipoUp)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }
    const just = String(justificativa || '').trim();
    if (!just) return res.status(400).json({ error: 'Justificativa obrigatória' });

    let dhSug = null;
    if (dataHoraSugerida) {
      const dt = new Date(dataHoraSugerida);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({ error: 'dataHoraSugerida inválida' });
      }
      dhSug = dt;
    }

    const sol = await prisma.solicitacaoAjustePonto.create({
      data: {
        tenantId,
        usuarioId,
        dia: String(dia),
        tipo: tipoUp,
        dataHoraSugerida: dhSug,
        justificativa: just,
      },
    });

    return res.status(201).json({ sucesso: true, solicitacao: sol });
  } catch (err) {
    next(err);
  }
}

async function excluirRegistroAdmin(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const adminId = req.usuario.id;
    const { registroId } = req.params;
    const { motivo } = req.body || {};

    const m = String(motivo || '').trim();
    if (!m) return res.status(400).json({ error: 'Motivo é obrigatório' });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { modoInviolavel: true },
    });
    if (tenant?.modoInviolavel) {
      return res.status(403).json({
        error: 'Exclusão de registros desabilitada (modo inviolável ativo).',
        code: 'MODO_INVIOLAVEL',
      });
    }

    const reg = await prisma.registroPonto.findFirst({
      where: { id: registroId, tenantId },
    });
    if (!reg) return res.status(404).json({ error: 'Registro não encontrado' });
    if (reg.deletedAt) return res.json({ sucesso: true, jaExcluido: true });

    const ipHash = ipHashFromReq(req);
    await prisma.registroPonto.update({
      where: { id: registroId },
      data: {
        deletedAt: new Date(),
        deletedById: adminId,
        deletedMotivo: m,
        validado: false,
      },
    });

    await registrarAuditoria({
      tenantId,
      entidade: 'RegistroPonto',
      entidadeId: registroId,
      acao: 'REGISTRO_EXCLUIDO',
      payloadAntes: {
        id: reg.id,
        nsr: reg.nsr,
        tipo: reg.tipo,
        dataHora: reg.dataHora,
        validado: reg.validado,
      },
      payloadDepois: { deletedMotivo: m },
      actorId: adminId,
      actorRole: req.usuario.role,
      ipHash,
    });

    return res.json({ sucesso: true });
  } catch (err) {
    next(err);
  }
}

async function comprovantePdf(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { registroId } = req.params;
    const usuarioIdColaborador =
      req.usuario.role === 'COLABORADOR' ? req.usuario.id : null;

    const result = await gerarComprovantePdfStream(registroId, tenantId, usuarioIdColaborador);
    if (!result) return res.status(404).json({ error: 'Registro não encontrado' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="comprovante_nsr${result.registro.nsr || registroId}.pdf"`
    );
    result.doc.pipe(res);
  } catch (err) {
    next(err);
  }
}

async function registrar(req, res, next) {
  try {
    const {
      tipo,
      latitude,
      longitude,
      deviceId,
      fotoBase64,
      forcarNovoTurno,
      confirmarRegistroCurto,
      clientRequestId,
      dataHoraCapturada,
    } = req.body;
    const usuarioId = req.usuario.id;
    const tenantId = req.tenantId || req.usuario.tenantId;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const tz = createTimezoneHelper(tenant.fusoHorario);
    const modoMarcacao = tenant.modoMarcacao || 'QUATRO_BATIDAS';
    const tiposValidos = tiposPermitidosRegistro(modoMarcacao);
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de ponto inválido para o modo de marcação da empresa' });
    }

    const usuarioCompleto = await prisma.usuario.findFirst({
      where: { id: usuarioId, tenantId },
      select: {
        localRegistroId: true,
        isentoGeofence: true,
        cpf: true,
        pis: true,
        consentimentoDadosEm: true,
        consentimentoDadosVersao: true,
      },
    });

    if (tenant.exigirCpfPis !== false && !usuarioTemDocumento(usuarioCompleto)) {
      return res.status(403).json({
        error: 'CPF ou PIS obrigatório para registrar ponto. Solicite ao RH que complete seu cadastro.',
        code: 'CPF_PIS_OBRIGATORIO',
      });
    }

    const origemBody = req.body.origem;
    let origem = 'TOTEM';
    if (origemBody === 'APP_INDIVIDUAL') {
      if (req.usuario.role !== 'COLABORADOR') {
        return res.status(403).json({ error: 'Registro pelo app é apenas para colaboradores' });
      }
      origem = 'APP_INDIVIDUAL';
    }

    if (origem === 'TOTEM' && tenant?.permitirTotem === false) {
      return res.status(403).json({ error: 'Registro por totem está desativado para esta empresa' });
    }
    if (origem === 'APP_INDIVIDUAL' && tenant?.permitirMeuPonto === false) {
      return res.status(403).json({ error: 'Registro pelo meu-ponto está desativado para esta empresa' });
    }

    const precisaConsentimento =
      origem === 'APP_INDIVIDUAL' && (tenant.geofenceAtivo || tenant.fotoObrigatoria);
    if (precisaConsentimento) {
      const consentOk =
        usuarioCompleto?.consentimentoDadosEm &&
        usuarioCompleto.consentimentoDadosVersao === CONSENTIMENTO_VERSAO_ATUAL;
      if (!consentOk) {
        return res.status(403).json({
          error: 'Aceite o termo de uso de dados (geolocalização/foto) antes de registrar ponto.',
          code: 'CONSENTIMENTO_OBRIGATORIO',
          versaoAtual: CONSENTIMENTO_VERSAO_ATUAL,
        });
      }
    }

    const agora = new Date();
    const ipHash = ipHashFromReq(req);

    if (origem === 'APP_INDIVIDUAL' && clientRequestId) {
      const cid = String(clientRequestId).trim();
      if (cid.length > 0 && cid.length <= 120) {
        const existente = await prisma.registroPonto.findFirst({
          where: { tenantId, usuarioId, clientRequestId: cid, deletedAt: null },
          include: { usuario: { select: { nome: true, cargo: true } } },
        });
        if (existente) {
          const prox = determinarProximoTipo(existente.tipo, modoMarcacao);
          return res.status(200).json({
            sucesso: true,
            idempotente: true,
            registro: {
              id: existente.id,
              nsr: existente.nsr,
              tipo: existente.tipo,
              dataHora: existente.dataHora,
              usuario: existente.usuario.nome,
              comprovanteUrl: urlComprovante(existente.id),
            },
            proximoTipo: prox,
            modoMarcacao,
          });
        }
      }
    }

    let dataHoraRegistro = agora;
    let clientReqIdDb = null;
    if (origem === 'APP_INDIVIDUAL' && clientRequestId) {
      const c = String(clientRequestId).trim();
      if (c.length > 0 && c.length <= 120) clientReqIdDb = c;
    }

    // Horário do cliente só em sincronização offline (clientRequestId); janela restrita
    if (origem === 'APP_INDIVIDUAL' && dataHoraCapturada && clientReqIdDb) {
      const d = new Date(dataHoraCapturada);
      if (!Number.isNaN(d.getTime())) {
        const maxFuturo = new Date(agora.getTime() + 5 * 60 * 1000);
        const maxPassadoOffline = new Date(agora.getTime() - 72 * 60 * 60 * 1000);
        if (d.getTime() <= maxFuturo.getTime() && d.getTime() >= maxPassadoOffline.getTime()) {
          dataHoraRegistro = d;
        }
      }
    }
    const refTime = dataHoraRegistro;
    const dataHoraUtc = agora;

    let dentroGeofence = null;
    if (tenant.geofenceAtivo && origem !== 'TOTEM' && !usuarioCompleto?.isentoGeofence) {
      if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Localização obrigatória para este tenant' });
      }

      const locais = await prisma.localRegistro.findMany({
        where: { tenantId, ativo: true },
        orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      });

      let permitido = false;
      if (locais.length > 0) {
        let alvo = locais;
        if (usuarioCompleto?.localRegistroId) {
          alvo = locais.filter((l) => l.id === usuarioCompleto.localRegistroId);
          if (alvo.length === 0) {
            return res.status(403).json({
              error: 'Seu cadastro está vinculado a um local que não está mais disponível. Fale com o RH.',
              code: 'LOCAL_INVALIDO',
            });
          }
        }
        const check = validarEmAlgumLocal(latitude, longitude, alvo);
        permitido = check.ok;
      } else if (tenant.geofenceLat != null && tenant.geofenceLng != null) {
        permitido = validarGeofence(
          latitude,
          longitude,
          tenant.geofenceLat,
          tenant.geofenceLng,
          tenant.geofenceRaio
        );
      } else {
        return res.status(400).json({
          error: 'Cerca virtual ativa: cadastre ao menos um local permitido ou coordenadas na empresa.',
        });
      }

      dentroGeofence = permitido;
      if (!permitido) {
        return res.status(403).json({
          error: 'Você não está dentro da área permitida para registro de ponto',
          code: 'FORA_GEOFENCE',
        });
      }
    }

    if (tenant.fotoObrigatoria && !fotoBase64) {
      return res.status(400).json({ error: 'Foto obrigatória para registro de ponto' });
    }

    let fotoUrl = null;
    let fotoKey = null;
    if (fotoBase64) {
      const resultado = await uploadFoto(fotoBase64, tenantId, usuarioId);
      fotoUrl = resultado.url;
      fotoKey = resultado.key;
    }

    {
      const { inicio, fim } = tz.inicioFimDoDia(refTime);
      const jaExiste = await prisma.registroPonto.findFirst({
        where: {
          tenantId,
          usuarioId,
          deletedAt: null,
          tipo,
          dataHora: { gte: inicio, lte: fim },
        },
        select: { id: true, dataHora: true, tipo: true },
      });
      if (jaExiste) {
        return res.status(409).json({
          error: 'Já existe uma marcação deste tipo para este colaborador hoje.',
          code: 'DUPLICADO_DIA',
          registroId: jaExiste.id,
          tipo: jaExiste.tipo,
          dataHora: jaExiste.dataHora,
        });
      }
    }

    const ultimo = await prisma.registroPonto.findFirst({
      where: { tenantId, usuarioId, deletedAt: null },
      orderBy: { dataHora: 'desc' },
      select: { id: true, tipo: true, dataHora: true, validado: true },
    });

    const ultimoEhHoje = Boolean(ultimo) && tz.isSameDay(ultimo.dataHora, refTime);
    const cicloAberto = turnoAbertoContinua(ultimo, refTime, {
      modoMarcacao,
      limiteHoras: LIMITE_TURNO_MAX_HORAS,
    });
    const proximoEsperado = resolverProximoTipo(ultimo, refTime, {
      modoMarcacao,
      limiteHoras: LIMITE_TURNO_MAX_HORAS,
    });
    const ultimoAbreCiclo = Boolean(ultimo) && !ultimoTipoFechaCiclo(ultimo.tipo, modoMarcacao);
    const horasDesdeUltimo = ultimo ? diffHoras(refTime, ultimo.dataHora) : 0;
    const segundosDesdeUltimo = ultimo ? diffSegundos(refTime, ultimo.dataHora) : 0;

    if (ultimo?.id && segundosDesdeUltimo < COOLDOWN_BATIDA_SEGUNDOS) {
      return res.status(409).json({
        error: 'Registro muito próximo do anterior. Aguarde alguns segundos e tente novamente.',
        code: 'REGISTRO_MUITO_RAPIDO',
        cooldownSegundos: COOLDOWN_BATIDA_SEGUNDOS,
        segundosDecorridos: Math.max(0, Math.round(segundosDesdeUltimo)),
        ultimo: {
          registroId: ultimo.id,
          tipo: ultimo.tipo,
          dataHora: ultimo.dataHora,
        },
      });
    }

    // Turno abandonado (expirou o limite): marca pendência e inicia novo ciclo.
    // Não trata virada de meia-noite com plantão ainda aberto como abandono.
    if (!forcarNovoTurno && ultimoAbreCiclo && !cicloAberto && ultimo?.id) {
      await prisma.registroPonto.update({
        where: { id: ultimo.id },
        data: { validado: false },
      });
    }

    const dadosRegistroBase = {
      tenantId,
      usuarioId,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      dentroGeofence,
      fotoUrl,
      fotoKey,
      deviceId,
      ipHash,
      userAgent: req.headers['user-agent']?.substring(0, 200),
      origem,
      clientRequestId: clientReqIdDb,
      actorId: usuarioId,
      actorRole: req.usuario.role,
    };

    if (!forcarNovoTurno && ultimoAbreCiclo && !cicloAberto && horasDesdeUltimo >= LIMITE_TURNO_MAX_HORAS) {
      await prisma.registroPonto.update({
        where: { id: ultimo.id },
        data: { validado: false },
      });

      const registro = await criarRegistroPonto({
        ...dadosRegistroBase,
        tipo: 'ENTRADA',
        dataHora: dataHoraRegistro,
        dataHoraUtc,
      });

      const prox = determinarProximoTipo(registro.tipo, modoMarcacao);
      return res.status(201).json({
        sucesso: true,
        aviso: {
          code: 'PENDENCIA_SAIDA_ESQUECIDA',
          message:
            'Detectamos uma marcação anterior em aberto há muito tempo. Iniciamos um novo turno e sinalizamos pendência para ajuste.',
          pendencia: {
            registroId: ultimo.id,
            ultimoTipo: ultimo.tipo,
            ultimoEm: ultimo.dataHora,
            horasAberto: Math.round(horasDesdeUltimo * 10) / 10,
            limiteHoras: LIMITE_TURNO_MAX_HORAS,
          },
        },
        registro: registroResponse(registro, prox),
        proximoTipo: prox,
        modoMarcacao,
      });
    }

    if (forcarNovoTurno === true) {
      if (tipo !== 'ENTRADA') {
        return res.status(400).json({ error: 'Para iniciar um novo turno, o tipo deve ser ENTRADA.' });
      }
      if (ultimoAbreCiclo && ultimo?.id) {
        await prisma.registroPonto.update({
          where: { id: ultimo.id },
          data: { validado: false },
        });
      }
    } else if (tipo !== proximoEsperado) {
      return res.status(409).json({
        error: 'Tipo de ponto inesperado para a sequência atual.',
        code: 'TIPO_INESPERADO',
        esperado: proximoEsperado,
        modoMarcacao,
      });
    }

    if (!forcarNovoTurno && confirmarRegistroCurto !== true && modoMarcacao !== 'DUAS_BATIDAS') {
      const minTrabalhoAntesSaidaMin =
        tenant?.trabalhoMinimoAntesSaidaMinutos ?? DEFAULT_MIN_TRABALHO_ANTES_SAIDA_MIN;
      const minIntervaloAlmocoMin =
        tenant?.intervaloMinimoAlmocoMinutos ?? DEFAULT_MIN_INTERVALO_ALMOCO_MIN;

      // Usa o último registro do turno aberto (pode ser do dia anterior em plantão noturno).
      const ultimoTurno = cicloAberto
        ? ultimo
        : (
            await prisma.registroPonto.findFirst({
              where: {
                tenantId,
                usuarioId,
                deletedAt: null,
                dataHora: (() => {
                  const { inicio, fim } = tz.inicioFimDoDia(refTime);
                  return { gte: inicio, lte: fim };
                })(),
              },
              orderBy: { dataHora: 'desc' },
              select: { id: true, tipo: true, dataHora: true },
            })
          );

      if (ultimoTurno?.id) {
        const minutos = diffMinutos(refTime, ultimoTurno.dataHora);

        if (
          (tipo === 'SAIDA_ALMOCO' || tipo === 'SAIDA') &&
          (ultimoTurno.tipo === 'ENTRADA' || ultimoTurno.tipo === 'RETORNO_ALMOCO') &&
          minutos < minTrabalhoAntesSaidaMin
        ) {
          return res.status(409).json({
            error:
              'Você ainda não completou o tempo mínimo de trabalho para este registro. Se for necessário, confirme para registrar mesmo assim.',
            code: 'REGISTRO_MUITO_CEDO',
            regra: 'MIN_TRABALHO',
            tipoTentado: tipo,
            ultimoTipo: ultimoTurno.tipo,
            ultimoEm: ultimoTurno.dataHora,
            minutosDecorridos: Math.round(minutos),
            minimoMinutos: minTrabalhoAntesSaidaMin,
          });
        }

        if (tipo === 'RETORNO_ALMOCO' && ultimoTurno.tipo === 'SAIDA_ALMOCO' && minutos < minIntervaloAlmocoMin) {
          return res.status(409).json({
            error:
              'O intervalo ainda não completou o tempo mínimo. Se for necessário, confirme para registrar mesmo assim.',
            code: 'REGISTRO_MUITO_CEDO',
            regra: 'MIN_INTERVALO',
            tipoTentado: tipo,
            ultimoTipo: ultimoTurno.tipo,
            ultimoEm: ultimoTurno.dataHora,
            minutosDecorridos: Math.round(minutos),
            minimoMinutos: minIntervaloAlmocoMin,
          });
        }
      }
    }

    const registro = await criarRegistroPonto({
      ...dadosRegistroBase,
      tipo,
      dataHora: dataHoraRegistro,
      dataHoraUtc,
    });

    const prox = determinarProximoTipo(registro.tipo, modoMarcacao);
    // Pendência de dia anterior só quando o ciclo expirou (não em plantão noturno válido).
    const avisoViradaDia =
      !forcarNovoTurno &&
      !ultimoEhHoje &&
      ultimoAbreCiclo &&
      !cicloAberto &&
      ultimo?.id
        ? {
            code: 'PENDENCIA_DIA_ANTERIOR',
            message:
              'Há batidas em aberto no dia anterior. Continue o ponto de hoje normalmente; use Pendências para justificar ou solicite ajuste do dia anterior.',
            pendencia: {
              registroId: ultimo.id,
              ultimoTipo: ultimo.tipo,
              ultimoEm: ultimo.dataHora,
            },
          }
        : null;

    res.status(201).json({
      sucesso: true,
      ...(avisoViradaDia ? { aviso: avisoViradaDia } : {}),
      registro: registroResponse(registro, prox),
      proximoTipo: prox,
      modoMarcacao,
      ...(cicloAberto && !ultimoEhHoje
        ? { turnoNoturno: true, turnoIniciadoEm: ultimo?.dataHora }
        : {}),
    });
  } catch (err) {
    next(err);
  }
}

async function listar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { usuarioId, dataInicio, dataFim, pagina = 1, limite = 50 } = req.query;

    const where = {
      tenantId,
      deletedAt: null,
      ...(usuarioId && { usuarioId }),
      ...(dataInicio && dataFim && {
        dataHora: {
          gte: new Date(dataInicio),
          lte: new Date(dataFim + 'T23:59:59'),
        },
      }),
    };

    const [registros, total] = await Promise.all([
      prisma.registroPonto.findMany({
        where,
        include: {
          usuario: { select: { nome: true, cargo: true, departamento: true } },
          ajuste: { select: { dataHoraNova: true, motivo: true } },
        },
        orderBy: { dataHora: 'desc' },
        skip: (pagina - 1) * limite,
        take: parseInt(limite),
      }),
      prisma.registroPonto.count({ where }),
    ]);

    const registrosComFoto = await Promise.all(
      registros.map(async (r) => ({
        ...r,
        fotoUrl: r.fotoKey ? await gerarUrlAssinada(r.fotoKey) : r.fotoUrl || null,
        comprovanteUrl: urlComprovante(r.id),
      }))
    );

    res.json({
      registros: registrosComFoto,
      total,
      paginas: Math.ceil(total / limite),
      paginaAtual: parseInt(pagina),
    });
  } catch (err) {
    next(err);
  }
}

async function ultimoPonto(req, res, next) {
  try {
    if (req.isSuperAdmin) {
      return res.status(403).json({ error: 'Operação disponível apenas para usuários da empresa' });
    }

    const { usuarioId } = req.params;
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    if (req.usuario.role === 'COLABORADOR' && req.usuario.id !== usuarioId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.role === 'ADMIN') {
      const alvo = await prisma.usuario.findFirst({
        where: { id: usuarioId, tenantId },
      });
      if (!alvo) return res.status(404).json({ error: 'Colaborador não encontrado' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { modoMarcacao: true, fusoHorario: true },
    });
    const modoMarcacao = tenant?.modoMarcacao || 'QUATRO_BATIDAS';
    const tz = createTimezoneHelper(tenant?.fusoHorario);

    const ultimo = await prisma.registroPonto.findFirst({
      where: { usuarioId, tenantId, deletedAt: null },
      orderBy: { dataHora: 'desc' },
      select: { id: true, tipo: true, dataHora: true, validado: true, nsr: true },
    });

    const agora = new Date();
    const cicloAberto = turnoAbertoContinua(ultimo, agora, {
      modoMarcacao,
      limiteHoras: LIMITE_TURNO_MAX_HORAS,
    });
    const ultimoEhHoje = Boolean(ultimo) && tz.isSameDay(ultimo.dataHora, agora);
    const proximoTipo = resolverProximoTipo(ultimo, agora, {
      modoMarcacao,
      limiteHoras: LIMITE_TURNO_MAX_HORAS,
    });

    const pendenciaCheckin = (() => {
      if (!ultimo) return { aberta: false };
      if (ultimoTipoFechaCiclo(ultimo.tipo, modoMarcacao)) return { aberta: false };
      const horas = diffHoras(new Date(), ultimo.dataHora);

      // Plantão noturno / turno aberto cross-midnight: continuar sequência (SAÍDA), sem tratar como erro.
      if (cicloAberto) {
        return {
          aberta: false,
          turnoAberto: true,
          cruzaMeiaNoite: !ultimoEhHoje,
          registroId: ultimo.id,
          ultimoTipo: ultimo.tipo,
          ultimoEm: ultimo.dataHora,
          horasAberto: Math.round(horas * 10) / 10,
          proximoTipo,
          motivo: !ultimoEhHoje ? 'TURNO_NOTURNO_ABERTO' : 'TURNO_ABERTO',
        };
      }

      if (!ultimoEhHoje) {
        return {
          aberta: false,
          diaAnteriorEmAberto: true,
          registroId: ultimo.id,
          ultimoTipo: ultimo.tipo,
          ultimoEm: ultimo.dataHora,
          horasAberto: Math.round(horas * 10) / 10,
          motivo: 'DIA_ANTERIOR_EM_ABERTO',
        };
      }
      if (horas < LIMITE_PENDENCIA_MODAL_HORAS) return { aberta: false };
      return {
        aberta: true,
        registroId: ultimo.id,
        ultimoTipo: ultimo.tipo,
        ultimoEm: ultimo.dataHora,
        horasAberto: Math.round(horas * 10) / 10,
        modalLimiteHoras: LIMITE_PENDENCIA_MODAL_HORAS,
        maxHorasAntesNovoTurno: LIMITE_TURNO_MAX_HORAS,
        sugerirNovoTurno: horas >= LIMITE_TURNO_MAX_HORAS,
        motivo: 'TURNO_LONGO_MESMO_DIA',
      };
    })();

    res.json({
      ultimoPonto: ultimo,
      proximoTipo,
      pendenciaCheckin,
      modoMarcacao,
      ...(cicloAberto && !ultimoEhHoje
        ? { turnoNoturno: true, turnoIniciadoEm: ultimo?.dataHora }
        : {}),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  registrar,
  listar,
  ultimoPonto,
  pendenciasColaborador,
  solicitarAjusteColaborador,
  excluirRegistroAdmin,
  comprovantePdf,
};
