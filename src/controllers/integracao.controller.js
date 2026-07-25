// src/controllers/integracao.controller.js — config InfinitePay (Super Admin)
const { obterConfigPainel, salvarConfig } = require('../services/integracaoInfinitipay.service');
const { criarLinkCheckout } = require('../services/infinitipay.service');

async function obterInfinitipay(req, res, next) {
  try {
    const config = await obterConfigPainel();
    res.json(config);
  } catch (err) {
    next(err);
  }
}

async function salvarInfinitipay(req, res, next) {
  try {
    const config = await salvarConfig(req.body, req.usuario?.email);
    res.json(config);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/** Teste leve: valida handle + URLs sem criar cobrança real */
async function testarInfinitipay(req, res, next) {
  try {
    const config = await obterConfigPainel();
    if (!config.handleEfetivo) {
      return res.status(400).json({ error: 'Informe a InfiniteTag (handle) antes de testar.' });
    }
    if (!config.ativo) {
      return res.status(400).json({ error: 'Ative a integração InfinitePay antes de testar.' });
    }

    const orderNsu = `pf-test-${Date.now()}`;
    const resultado = await criarLinkCheckout({
      orderNsu,
      items: [{ quantity: 1, price: 100, description: 'Teste PontoFácil — integração InfinitePay' }],
      redirectUrl: config.redirectUrlEfetiva,
      webhookUrl: config.webhookUrlEfetiva || undefined,
    });

    res.json({
      ok: true,
      mensagem: 'Link de teste gerado com sucesso (R$ 1,00). Abra para validar o checkout.',
      orderNsu,
      checkoutUrl: resultado.checkoutUrl,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    next(err);
  }
}

module.exports = { obterInfinitipay, salvarInfinitipay, testarInfinitipay };
