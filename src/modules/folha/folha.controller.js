// src/modules/folha/folha.controller.js
const repo = require('./folha.repository');
const { montarEspelhoMensal } = require('../relatorios/espelho.service');
const { calcularHolerite, validarPendencias } = require('./payroll.engine');
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
    } = req.body;

    const data = {};
    if (modoBancoHoras !== undefined) data.modoBancoHoras = modoBancoHoras;
    if (heDiaUtilPercent !== undefined) data.heDiaUtilPercent = Number(heDiaUtilPercent);
    if (heDomingoFeriadoPercent !== undefined) data.heDomingoFeriadoPercent = Number(heDomingoFeriadoPercent);
    if (adicionalNoturnoPercent !== undefined) data.adicionalNoturnoPercent = Number(adicionalNoturnoPercent);
    if (toleranciaAtrasoMin !== undefined) data.toleranciaAtrasoMin = toleranciaAtrasoMin == null ? null : Number(toleranciaAtrasoMin);
    if (pagarDSR !== undefined) data.pagarDSR = Boolean(pagarDSR);
    if (permitirFolhaSemAssinatura !== undefined) data.permitirFolhaSemAssinatura = Boolean(permitirFolhaSemAssinatura);
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

      const calc = calcularHolerite(config, espelhoEnriquecido, usuario);
      if (calc.erro) {
        pendencias.push({
          tipo: 'ERRO_CALCULO',
          usuarioId: usuario.id,
          nome: usuario.nome,
          mensagem: calc.erro,
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

module.exports = {
  getConfig,
  putConfig,
  calcular,
  listarRuns,
  obterRun,
  fechar,
  downloadHoleritePdf,
  exportCnab,
};
