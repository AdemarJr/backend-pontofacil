// Cobranças de plano via InfinitePay + webhook
const prisma = require('../infra/prisma');
const { criarLinkCheckout, consultarPagamento } = require('../services/infinitipay.service');
const { mapearEnumPorMaxColaboradores } = require('../shared/planLimits');
const { resolverDadosContrato } = require('../shared/contractPeriod');

async function aplicarPagamentoAprovado(pagamento, webhookPayload = {}) {
  const plano = await prisma.planoComercial.findUnique({ where: { id: pagamento.planoComercialId } });
  if (!plano) return;

  const enumPlano = mapearEnumPorMaxColaboradores(plano.maxColaboradores);

  let dadosContrato = {};
  try {
    dadosContrato = resolverDadosContrato({
      contractStartDate: new Date(),
      periodoContrato: 'MENSAL',
    });
  } catch {
    dadosContrato = {};
  }

  await prisma.$transaction(async (tx) => {
    await tx.pagamentoPlano.update({
      where: { id: pagamento.id },
      data: {
        status: 'PAGO',
        paidAt: new Date(),
        transactionNsu: webhookPayload.transaction_nsu || pagamento.transactionNsu,
        invoiceSlug: webhookPayload.invoice_slug || pagamento.invoiceSlug,
        receiptUrl: webhookPayload.receipt_url || pagamento.receiptUrl,
        captureMethod: webhookPayload.capture_method || pagamento.captureMethod,
        valorCentavos: webhookPayload.paid_amount ?? pagamento.valorCentavos,
      },
    });

    await tx.tenant.update({
      where: { id: pagamento.tenantId },
      data: {
        planoComercialId: pagamento.planoComercialId,
        plano: enumPlano,
        status: 'ATIVO',
        ...dadosContrato,
      },
    });
  });
}

async function criarCobrancaTenant(req, res, next) {
  try {
    const { id: tenantId } = req.params;
    const { planoComercialId } = req.body;

    if (!planoComercialId) {
      return res.status(400).json({ error: 'planoComercialId é obrigatório' });
    }

    const [tenant, plano] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          usuarios: { where: { role: 'ADMIN' }, take: 1, select: { nome: true, email: true } },
        },
      }),
      prisma.planoComercial.findFirst({ where: { id: planoComercialId, ativo: true } }),
    ]);

    if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (!plano) return res.status(404).json({ error: 'Plano comercial não encontrado ou inativo' });

    const orderNsu = `pf-${tenantId.slice(0, 8)}-${Date.now()}`;
    const admin = tenant.usuarios?.[0];

    let checkout;
    try {
      checkout = await criarLinkCheckout({
        orderNsu,
        items: [
          {
            quantity: 1,
            price: plano.valorCentavos,
            description: `PontoFácil — ${plano.nome} (${tenant.nomeFantasia})`,
          },
        ],
        customer: admin
          ? { name: admin.nome, email: admin.email }
          : { name: tenant.nomeFantasia, email: tenant.email },
      });
    } catch (e) {
      if (e.code === 'INFINITEPAY_NOT_CONFIGURED') {
        return res.status(503).json({ error: e.message, code: e.code });
      }
      throw e;
    }

    const pagamento = await prisma.pagamentoPlano.create({
      data: {
        tenantId,
        planoComercialId: plano.id,
        orderNsu,
        valorCentavos: plano.valorCentavos,
        checkoutUrl: checkout.checkoutUrl,
        status: 'PENDENTE',
      },
      include: { planoComercial: true },
    });

    res.status(201).json({
      pagamento,
      checkoutUrl: checkout.checkoutUrl,
      mensagem: 'Link de pagamento gerado. Envie ao cliente ou abra para concluir a cobrança.',
    });
  } catch (err) {
    next(err);
  }
}

async function listarPagamentosTenant(req, res, next) {
  try {
    const { id: tenantId } = req.params;
    const pagamentos = await prisma.pagamentoPlano.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { planoComercial: { select: { id: true, nome: true, valorCentavos: true } } },
      take: 50,
    });
    res.json(pagamentos);
  } catch (err) {
    next(err);
  }
}

async function webhookInfinitipay(req, res) {
  try {
    const body = req.body || {};
    const orderNsu = body.order_nsu || body.orderNsu;
    if (!orderNsu) {
      return res.status(400).json({ error: 'order_nsu ausente' });
    }

    const pagamento = await prisma.pagamentoPlano.findUnique({
      where: { orderNsu: String(orderNsu) },
    });
    if (!pagamento) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    if (pagamento.status === 'PAGO') {
      return res.status(200).json({ ok: true, alreadyPaid: true });
    }

    await aplicarPagamentoAprovado(pagamento, body);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook/infinitipay]', err?.message || err);
    return res.status(400).json({ error: 'Falha ao processar webhook' });
  }
}

async function confirmarRetornoPagamento(req, res, next) {
  try {
    const orderNsu = req.query.order_nsu || req.query.orderNsu;
    const transactionNsu = req.query.transaction_nsu || req.query.transactionNsu;
    const slug = req.query.slug;

    if (!orderNsu) {
      return res.status(400).json({ error: 'order_nsu é obrigatório' });
    }

    const pagamento = await prisma.pagamentoPlano.findUnique({
      where: { orderNsu: String(orderNsu) },
      include: { planoComercial: true, tenant: { select: { nomeFantasia: true } } },
    });
    if (!pagamento) return res.status(404).json({ error: 'Pagamento não encontrado' });

    if (pagamento.status === 'PAGO') {
      return res.json({ status: 'PAGO', pagamento, tenant: pagamento.tenant });
    }

    try {
      const check = await consultarPagamento({
        orderNsu: String(orderNsu),
        transactionNsu: transactionNsu ? String(transactionNsu) : undefined,
        slug: slug ? String(slug) : pagamento.invoiceSlug || undefined,
      });
      if (check?.paid || check?.success === true && check?.paid === true) {
        await aplicarPagamentoAprovado(pagamento, {
          transaction_nsu: transactionNsu,
          invoice_slug: slug,
          paid_amount: check.paid_amount ?? check.amount,
          capture_method: check.capture_method,
        });
        const atualizado = await prisma.pagamentoPlano.findUnique({
          where: { orderNsu: String(orderNsu) },
          include: { planoComercial: true, tenant: { select: { nomeFantasia: true } } },
        });
        return res.json({ status: 'PAGO', pagamento: atualizado, tenant: atualizado.tenant });
      }
      return res.json({ status: 'PENDENTE', pagamento, check });
    } catch (e) {
      if (e.code === 'INFINITEPAY_NOT_CONFIGURED') {
        return res.status(503).json({ error: e.message, code: e.code });
      }
      return res.json({ status: pagamento.status, pagamento, aviso: 'Não foi possível confirmar com a InfinitePay agora' });
    }
  } catch (err) {
    next(err);
  }
}

module.exports = {
  criarCobrancaTenant,
  listarPagamentosTenant,
  webhookInfinitipay,
  confirmarRetornoPagamento,
  aplicarPagamentoAprovado,
};
