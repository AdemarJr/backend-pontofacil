// src/modules/folha/folha.controller.js
const repo = require('./folha.repository');
const { montarEspelhoMensal } = require('../relatorios/espelho.service');
const { calcularHolerite, validarPendencias } = require('./payroll.engine');
const { calcularPagamentoFerias } = require('./payroll.feriasPagamento');
const { calcularDecimoTerceiro } = require('./payroll.decimo');
const { calcularAdiantamentoSalarial } = require('./payroll.adiantamento');
const { calcularRescisao } = require('./payroll.rescisao');
const { calcularSaldoFerias } = require('./payroll.saldoFerias');
const { diasEntreISO } = require('./payroll.shared');
const { gerarHoleritePdf } = require('./holerite-pdf.service');
const { gerarCnab240 } = require('./cnab/cnab240.pagamento');
const prisma = require('../../infra/prisma');

async function getConfig(req, res, next) {
  try {
    const config = await repo.getOrCreateConfig(req.tenantId);
    res.json(config);
  } catch (err) { next(err); }
}

async function putConfig(req, res, next) {
  try {
    const {
      modoBancoHoras, heDiaUtilPercent, heDomingoFeriadoPercent,
      adicionalNoturnoPercent, toleranciaAtrasoMin, pagarDSR,
      permitirFolhaSemAssinatura, bancoCodigo, bancoAgencia, bancoConta, bancoConvenio,
      vtPercentMax, vtProporcionalFaltas,       descontarAtrasos, descontoAtrasoDiarioPercent,
      descontarIntervaloInsuficiente, descontoIntervaloDiarioPercent,
      adiantamentoPercent, descontarAdiantamentoNaFolha,
    } = req.body;

    const data = {};
    if (modoBancoHoras !== undefined) data.modoBancoHoras = modoBancoHoras;
    if (heDiaUtilPercent !== undefined) data.heDiaUtilPercent = Number(heDiaUtilPercent);
    if (heDomingoFeriadoPercent !== undefined) data.heDomingoFeriadoPercent = Number(heDomingoFeriadoPercent);
    if (adicionalNoturnoPercent !== undefined) data.adicionalNoturnoPercent = Number(adicionalNoturnoPercent);
    if (toleranciaAtrasoMin !== undefined) data.toleranciaAtrasoMin = toleranciaAtrasoMin == null ? null : Number(toleranciaAtrasoMin);
    if (pagarDSR !== undefined) data.pagarDSR = Boolean(pagarDSR);
    if (permitirFolhaSemAssinatura !== undefined) data.permitirFolhaSemAssinatura = Boolean(permitirFolhaSemAssinatura);
    if (vtPercentMax !== undefined) data.vtPercentMax = Math.min(6, Math.max(0, Number(vtPercentMax)));
    if (vtProporcionalFaltas !== undefined) data.vtProporcionalFaltas = Boolean(vtProporcionalFaltas);
    if (descontarAtrasos !== undefined) data.descontarAtrasos = Boolean(descontarAtrasos);
    if (descontoAtrasoDiarioPercent !== undefined) data.descontoAtrasoDiarioPercent = Number(descontoAtrasoDiarioPercent);
    if (descontarIntervaloInsuficiente !== undefined) data.descontarIntervaloInsuficiente = Boolean(descontarIntervaloInsuficiente);
    if (descontoIntervaloDiarioPercent !== undefined) data.descontoIntervaloDiarioPercent = Number(descontoIntervaloDiarioPercent);
    if (adiantamentoPercent !== undefined) {
      data.adiantamentoPercent = Math.min(100, Math.max(0, Number(adiantamentoPercent) || 0));
    }
    if (descontarAdiantamentoNaFolha !== undefined) {
      data.descontarAdiantamentoNaFolha = Boolean(descontarAdiantamentoNaFolha);
    }
    if (bancoCodigo !== undefined) data.bancoCodigo = bancoCodigo || null;
    if (bancoAgencia !== undefined) data.bancoAgencia = bancoAgencia || null;
    if (bancoConta !== undefined) data.bancoConta = bancoConta || null;
    if (bancoConvenio !== undefined) data.bancoConvenio = bancoConvenio || null;

    const config = await repo.updateConfig(req.tenantId, data);
    res.json(config);
  } catch (err) { next(err); }
}

async function calcular(req, res, next) {
  try {
    const mes = parseInt(req.body.mes) || new Date().getMonth() + 1;
    const ano = parseInt(req.body.ano) || new Date().getFullYear();

    const config = await repo.getOrCreateConfig(req.tenantId);
    const colaboradores = await repo.listColaboradoresCLT(req.tenantId);
    const colabMap = Object.fromEntries(colaboradores.map((c) => [c.id, c]));

    const adiantamentoRun = await repo.findAdiantamentoRun(req.tenantId, mes, ano);
    const adiantamentoPorUsuario = Object.fromEntries(
      (adiantamentoRun?.holerites || []).map((h) => [h.usuarioId, Number(h.liquido)]),
    );

    const { relatorio } = await montarEspelhoMensal(req.tenantId, mes, ano);

    const pendencias = [];
    const holerites = [];

    for (const item of relatorio) {
      if (item.usuario?.tipoContrato && item.usuario.tipoContrato !== 'CLT') continue;
      const usuario = colabMap[item.usuario.id] || item.usuario;
      const espelhoEnriquecido = {
        ...item,
        periodoMes: mes,
        periodoAno: ano,
        usuario: { ...item.usuario, ...usuario },
      };

      pendencias.push(...validarPendencias(espelhoEnriquecido, config));

      const calc = calcularHolerite(config, espelhoEnriquecido, usuario, {
        valorAdiantamento: adiantamentoPorUsuario[usuario.id] || 0,
      });
      if (calc.erro) {
        pendencias.push({
          tipo: 'ERRO_CALCULO',
          usuarioId: usuario.id,
          nome: usuario.nome,
          mensagem: calc.erro,
          label: 'Erro no cálculo',
        });
        continue;
      }

      holerites.push({
        usuarioId: usuario.id,
        proventos: calc.proventos,
        descontos: calc.descontos,
        bases: calc.bases,
        liquido: calc.liquido,
      });
    }

    const run = await repo.upsertRunWithHolerites(req.tenantId, mes, ano, {
      status: 'CALCULADA',
      bloqueadaPorPendencias: pendencias.length ? { pendencias } : null,
      holerites,
    });

    res.json({ run, pendencias });
  } catch (err) { next(err); }
}

async function listarRuns(req, res, next) {
  try {
    const runs = await repo.listRuns(req.tenantId, req.query);
    res.json(runs);
  } catch (err) { next(err); }
}

async function obterRun(req, res, next) {
  try {
    const run = await repo.findRunById(req.tenantId, req.params.id);
    if (!run) return res.status(404).json({ error: 'Folha não encontrada' });
    res.json(run);
  } catch (err) { next(err); }
}

async function fechar(req, res, next) {
  try {
    const run = await repo.findRunById(req.tenantId, req.params.id);
    if (!run) return res.status(404).json({ error: 'Folha não encontrada' });
    if (run.status === 'FECHADA') return res.status(400).json({ error: 'Folha já fechada' });

    const config = await repo.getOrCreateConfig(req.tenantId);
    const pendencias = run.bloqueadaPorPendencias?.pendencias || [];
    if (pendencias.length && !config.permitirFolhaSemAssinatura) {
      return res.status(400).json({
        error: 'Existem pendências que impedem o fechamento',
        pendencias,
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { razaoSocial: true, nomeFantasia: true, cnpj: true },
    });

    const pdfUpdates = [];
    for (const h of run.holerites) {
      const buf = await gerarHoleritePdf({
        tenant,
        usuario: h.usuario,
        holerite: h,
        periodo: { mes: run.mes, ano: run.ano },
      });
      const pdfKey = `holerites/${req.tenantId}/${run.id}/${h.id}.pdf`;
      pdfUpdates.push({ holeriteId: h.id, pdfKey, buffer: buf });
    }

    await repo.fecharRun(req.tenantId, run.id, req.usuario.id, pdfUpdates);

    const atualizado = await repo.findRunById(req.tenantId, run.id);
    res.json(atualizado);
  } catch (err) { next(err); }
}

async function downloadHoleritePdf(req, res, next) {
  try {
    const holerite = await repo.findHolerite(req.tenantId, req.params.id);
    if (!holerite) return res.status(404).json({ error: 'Holerite não encontrado' });

    const tenant = holerite.folhaRun.tenant;
    const buf = await gerarHoleritePdf({
      tenant,
      usuario: holerite.usuario,
      holerite,
      periodo: { mes: holerite.folhaRun.mes, ano: holerite.folhaRun.ano },
    });

    const nome = `holerite-${holerite.usuario.nome.replace(/\s+/g, '-')}-${holerite.folhaRun.mes}-${holerite.folhaRun.ano}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(buf);
  } catch (err) { next(err); }
}

async function exportCnab(req, res, next) {
  try {
    const run = await repo.findRunById(req.tenantId, req.params.id);
    if (!run) return res.status(404).json({ error: 'Folha não encontrada' });
    if (run.status !== 'FECHADA' && run.status !== 'PAGA') {
      return res.status(400).json({ error: 'Folha deve estar fechada para exportar CNAB' });
    }

    const config = await repo.getOrCreateConfig(req.tenantId);
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });

    if (!config.bancoCodigo || !config.bancoAgencia || !config.bancoConta) {
      return res.status(400).json({ error: 'Configure os dados bancários da empresa em Configuração da Folha' });
    }

    const pagamentos = run.holerites
      .filter((h) => Number(h.liquido) > 0 && h.usuario.contaNumero)
      .map((h) => ({
        nome: h.usuario.nome,
        cpf: h.usuario.cpf,
        banco: h.usuario.contaBanco,
        agencia: h.usuario.contaAgencia,
        conta: h.usuario.contaNumero,
        valor: Number(h.liquido),
        contaTipo: h.usuario.contaTipo,
      }));

    if (!pagamentos.length) {
      return res.status(400).json({ error: 'Nenhum colaborador com dados bancários e valor líquido para pagamento' });
    }

    const conteudo = gerarCnab240({
      empresa: {
        cnpj: tenant.cnpj,
        razaoSocial: tenant.razaoSocial,
        bancoCodigo: config.bancoCodigo,
        bancoAgencia: config.bancoAgencia,
        bancoConta: config.bancoConta,
        bancoConvenio: config.bancoConvenio,
      },
      pagamentos,
    });

    const filename = `folha-${run.mes}-${run.ano}.rem`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(conteudo);
  } catch (err) { next(err); }
}

async function saldoFeriasColaborador(req, res, next) {
  try {
    const usuario = await repo.findUsuarioCLT(req.tenantId, req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Colaborador CLT não encontrado' });
    const saldo = await calcularSaldoFerias(req.tenantId, usuario.id);
    res.json({ usuario: { id: usuario.id, nome: usuario.nome }, ...saldo });
  } catch (err) { next(err); }
}

async function calcularFeriasPagamento(req, res, next) {
  try {
    const {
      usuarioId, feriasId, diasFerias, diasAbono, adiantamentoUmTerco,
      dataInicio, dataFim, mesReferencia, anoReferencia,
    } = req.body;

    const usuario = await repo.findUsuarioCLT(req.tenantId, usuarioId);
    if (!usuario) return res.status(404).json({ error: 'Colaborador CLT não encontrado' });

    let ferias = null;
    let diasF = diasFerias;
    let diasA = diasAbono ?? 0;
    let inicio = dataInicio;
    let fim = dataFim;

    if (feriasId) {
      ferias = await prisma.ferias.findFirst({
        where: { id: feriasId, tenantId: req.tenantId, usuarioId, status: 'APROVADA' },
      });
      if (!ferias) return res.status(404).json({ error: 'Férias aprovadas não encontradas' });
      inicio = ferias.dataInicio;
      fim = ferias.dataFim;
      diasF = diasEntreISO(inicio, fim);
    } else {
      diasF = Number(diasFerias) || 0;
      if (!inicio) {
        const hoje = new Date();
        inicio = hoje.toISOString().slice(0, 10);
        const fimDt = new Date(hoje);
        fimDt.setDate(fimDt.getDate() + Math.max(0, diasF - 1));
        fim = fim || fimDt.toISOString().slice(0, 10);
      }
    }

    const config = await repo.getOrCreateConfig(req.tenantId);
    const calc = calcularPagamentoFerias({
      config,
      usuario,
      diasFerias: diasF,
      diasAbono: diasA,
      adiantamentoUmTerco,
    });
    if (calc.erro) return res.status(400).json({ error: calc.erro });

    const ref = new Date();
    const mesRef = mesReferencia || ref.getMonth() + 1;
    const anoRef = anoReferencia || ref.getFullYear();

    const pagamento = await repo.createFeriasPagamento(req.tenantId, {
      usuarioId,
      feriasId: ferias?.id || null,
      diasFerias: diasF,
      diasAbono: diasA,
      adiantamentoUmTerco: adiantamentoUmTerco !== false,
      dataInicio: inicio,
      dataFim: fim,
      mesReferencia: mesRef,
      anoReferencia: anoRef,
      proventos: calc.proventos,
      descontos: calc.descontos,
      bases: calc.bases,
      liquido: calc.liquido,
    });

    res.json({ pagamento, calculo: calc });
  } catch (err) { next(err); }
}

async function listarFeriasPagamentos(req, res, next) {
  try {
    const lista = await repo.listFeriasPagamentos(req.tenantId, req.query);
    res.json(lista);
  } catch (err) { next(err); }
}

async function downloadFeriasPagamentoPdf(req, res, next) {
  try {
    const pag = await repo.findFeriasPagamento(req.tenantId, req.params.id);
    if (!pag) return res.status(404).json({ error: 'Pagamento de férias não encontrado' });

    const buf = await gerarHoleritePdf({
      tenant: pag.tenant,
      usuario: pag.usuario,
      holerite: pag,
      periodo: { mes: pag.mesReferencia, ano: pag.anoReferencia },
      titulo: 'RECIBO DE FÉRIAS',
      subtitulo: `Período: ${pag.dataInicio} a ${pag.dataFim} · Ref. ${String(pag.mesReferencia).padStart(2, '0')}/${pag.anoReferencia}`,
    });

    const nome = `ferias-${pag.usuario.nome.replace(/\s+/g, '-')}-${pag.id.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(buf);
  } catch (err) { next(err); }
}

async function calcularDecimo(req, res, next) {
  try {
    const ano = parseInt(req.body.ano) || new Date().getFullYear();
    const parcela = parseInt(req.body.parcela);
    if (parcela !== 1 && parcela !== 2) {
      return res.status(400).json({ error: 'Parcela deve ser 1 ou 2' });
    }

    const config = await repo.getOrCreateConfig(req.tenantId);
    let colaboradores = await repo.listColaboradoresCLT(req.tenantId);
    if (req.body.usuarioIds?.length) {
      const ids = new Set(req.body.usuarioIds);
      colaboradores = colaboradores.filter((c) => ids.has(c.id));
    }

    const holerites = [];
    const erros = [];

    for (const usuario of colaboradores) {
      const calc = calcularDecimoTerceiro({ config, usuario, ano, parcela });
      if (calc.erro) {
        erros.push({ usuarioId: usuario.id, nome: usuario.nome, mensagem: calc.erro });
        continue;
      }
      holerites.push({
        usuarioId: usuario.id,
        mesesTrabalhados: calc.mesesTrabalhados,
        proventos: calc.proventos,
        descontos: calc.descontos,
        bases: calc.bases,
        liquido: calc.liquido,
      });
    }

    const run = await repo.upsertDecimoRun(req.tenantId, ano, parcela, holerites);
    res.json({ run, erros });
  } catch (err) { next(err); }
}

async function listarDecimoRuns(req, res, next) {
  try {
    const runs = await repo.listDecimoRuns(req.tenantId, req.query);
    res.json(runs);
  } catch (err) { next(err); }
}

async function obterDecimoRun(req, res, next) {
  try {
    const run = await repo.findDecimoRunById(req.tenantId, req.params.id);
    if (!run) return res.status(404).json({ error: 'Cálculo de 13º não encontrado' });
    res.json(run);
  } catch (err) { next(err); }
}

async function downloadDecimoHoleritePdf(req, res, next) {
  try {
    const holerite = await repo.findDecimoHolerite(req.tenantId, req.params.id);
    if (!holerite) return res.status(404).json({ error: 'Holerite de 13º não encontrado' });

    const buf = await gerarHoleritePdf({
      tenant: holerite.run.tenant,
      usuario: holerite.usuario,
      holerite,
      periodo: { ano: holerite.run.ano },
      titulo: `13º SALÁRIO — ${holerite.run.parcela}ª PARCELA`,
      subtitulo: `Ano ${holerite.run.ano} · ${holerite.mesesTrabalhados}/12 avos`,
    });

    const nome = `decimo-${holerite.usuario.nome.replace(/\s+/g, '-')}-${holerite.run.ano}-p${holerite.run.parcela}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(buf);
  } catch (err) { next(err); }
}

async function calcularAdiantamento(req, res, next) {
  try {
    const mes = parseInt(req.body.mes) || new Date().getMonth() + 1;
    const ano = parseInt(req.body.ano) || new Date().getFullYear();

    const config = await repo.getOrCreateConfig(req.tenantId);
    const percent = req.body.percent != null
      ? Math.min(100, Math.max(0, Number(req.body.percent) || 0))
      : (config.adiantamentoPercent ?? 40);

    if (percent <= 0) {
      return res.status(400).json({ error: 'Percentual de adiantamento inválido' });
    }

    let colaboradores = await repo.listColaboradoresCLT(req.tenantId);
    if (req.body.usuarioIds?.length) {
      const ids = new Set(req.body.usuarioIds);
      colaboradores = colaboradores.filter((c) => ids.has(c.id));
    }

    const holerites = [];
    const erros = [];

    for (const usuario of colaboradores) {
      const calc = calcularAdiantamentoSalarial({ usuario, percent });
      if (calc.erro) {
        erros.push({ usuarioId: usuario.id, nome: usuario.nome, mensagem: calc.erro });
        continue;
      }
      holerites.push({
        usuarioId: usuario.id,
        percent: calc.percent,
        proventos: calc.proventos,
        descontos: calc.descontos,
        bases: calc.bases,
        liquido: calc.liquido,
      });
    }

    const run = await repo.upsertAdiantamentoRun(req.tenantId, mes, ano, percent, holerites);
    res.json({ run, erros });
  } catch (err) { next(err); }
}

async function listarAdiantamentoRuns(req, res, next) {
  try {
    const runs = await repo.listAdiantamentoRuns(req.tenantId, req.query);
    res.json(runs);
  } catch (err) { next(err); }
}

async function obterAdiantamentoRun(req, res, next) {
  try {
    const run = await repo.findAdiantamentoRunById(req.tenantId, req.params.id);
    if (!run) return res.status(404).json({ error: 'Cálculo de adiantamento não encontrado' });
    res.json(run);
  } catch (err) { next(err); }
}

async function downloadAdiantamentoHoleritePdf(req, res, next) {
  try {
    const holerite = await repo.findAdiantamentoHolerite(req.tenantId, req.params.id);
    if (!holerite) return res.status(404).json({ error: 'Holerite de adiantamento não encontrado' });

    const buf = await gerarHoleritePdf({
      tenant: holerite.run.tenant,
      usuario: holerite.usuario,
      holerite,
      periodo: { mes: holerite.run.mes, ano: holerite.run.ano },
      titulo: 'ADIANTAMENTO SALARIAL',
      subtitulo: `Ref. ${String(holerite.run.mes).padStart(2, '0')}/${holerite.run.ano} · ${holerite.percent}% do salário`,
    });

    const nome = `adiantamento-${holerite.usuario.nome.replace(/\s+/g, '-')}-${holerite.run.mes}-${holerite.run.ano}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(buf);
  } catch (err) { next(err); }
}

async function calcularRescisaoEndpoint(req, res, next) {
  try {
    const {
      usuarioId, tipo, dataDesligamento,
      avisoPrevioIndenizado, diasAvisoPrevio, observacoes,
    } = req.body;

    const usuario = await repo.findUsuarioCLT(req.tenantId, usuarioId);
    if (!usuario) return res.status(404).json({ error: 'Colaborador CLT não encontrado' });

    const config = await repo.getOrCreateConfig(req.tenantId);
    const calc = await calcularRescisao({
      tenantId: req.tenantId,
      usuario,
      config,
      tipo,
      dataDesligamento,
      avisoPrevioIndenizado,
      diasAvisoPrevio,
    });
    if (calc.erro) return res.status(400).json({ error: calc.erro });

    const rescisao = await repo.createRescisao(req.tenantId, {
      usuarioId,
      tipo: String(tipo).toUpperCase(),
      dataDesligamento: new Date(dataDesligamento),
      avisoPrevioIndenizado: Boolean(avisoPrevioIndenizado),
      diasAvisoPrevio: Number(diasAvisoPrevio) || 0,
      proventos: calc.proventos,
      descontos: calc.descontos,
      bases: calc.bases,
      liquido: calc.liquido,
      multaFgtsEstimada: calc.multaFgtsEstimada || null,
      observacoes: observacoes || null,
    });

    res.json({ rescisao, calculo: calc, detalhes: calc.detalhes });
  } catch (err) { next(err); }
}

async function listarRescisoes(req, res, next) {
  try {
    const lista = await repo.listRescisoes(req.tenantId, req.query);
    res.json(lista);
  } catch (err) { next(err); }
}

async function downloadRescisaoPdf(req, res, next) {
  try {
    const rescisao = await repo.findRescisao(req.tenantId, req.params.id);
    if (!rescisao) return res.status(404).json({ error: 'Rescisão não encontrada' });

    const dt = new Date(rescisao.dataDesligamento);
    const buf = await gerarHoleritePdf({
      tenant: rescisao.tenant,
      usuario: rescisao.usuario,
      holerite: rescisao,
      periodo: { mes: dt.getMonth() + 1, ano: dt.getFullYear() },
      titulo: 'TERMO DE RESCISÃO — DEMONSTRATIVO',
      subtitulo: `Desligamento: ${dt.toLocaleDateString('pt-BR')} · ${rescisao.tipo.replace(/_/g, ' ')}`,
    });

    const nome = `rescisao-${rescisao.usuario.nome.replace(/\s+/g, '-')}-${rescisao.id.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(buf);
  } catch (err) { next(err); }
}

module.exports = {
  getConfig,
  putConfig,
  calcular,
  listarRuns,
  obterRun,
  fechar,
  downloadHoleritePdf,
  exportCnab,
  saldoFeriasColaborador,
  calcularFeriasPagamento,
  listarFeriasPagamentos,
  downloadFeriasPagamentoPdf,
  calcularDecimo,
  listarDecimoRuns,
  obterDecimoRun,
  downloadDecimoHoleritePdf,
  calcularAdiantamento,
  listarAdiantamentoRuns,
  obterAdiantamentoRun,
  downloadAdiantamentoHoleritePdf,
  calcularRescisaoEndpoint,
  listarRescisoes,
  downloadRescisaoPdf,
};
