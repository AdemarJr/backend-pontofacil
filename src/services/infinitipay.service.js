// Integração InfinitePay Checkout (links de pagamento Pix/cartão)
// Docs: https://www.infinitepay.io/checkout-documentacao

const { obterConfigOperacional } = require('./integracaoInfinitipay.service');

const API_BASE = 'https://api.checkout.infinitepay.io';

async function parseJsonResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `InfinitePay HTTP ${res.status}`);
    err.status = 502;
    err.details = data;
    throw err;
  }
  return data;
}

/**
 * Cria link de checkout InfinitePay.
 */
async function criarLinkCheckout(params) {
  const cfg = await obterConfigOperacional();
  const payload = {
    handle: cfg.handle,
    order_nsu: params.orderNsu,
    items: params.items,
    redirect_url: params.redirectUrl || cfg.redirectUrl,
    webhook_url: params.webhookUrl || cfg.webhookUrl,
  };
  if (params.customer) payload.customer = params.customer;

  const res = await fetch(`${API_BASE}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse(res);
  const checkoutUrl = data.url || data.checkout_url || data.link;
  if (!checkoutUrl) {
    const err = new Error('InfinitePay não retornou URL de checkout');
    err.status = 502;
    err.details = data;
    throw err;
  }
  return { checkoutUrl, raw: data };
}

async function consultarPagamento({ orderNsu, transactionNsu, slug }) {
  const cfg = await obterConfigOperacional();
  const res = await fetch(`${API_BASE}/payment_check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      handle: cfg.handle,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug,
    }),
  });
  return parseJsonResponse(res);
}

module.exports = {
  criarLinkCheckout,
  consultarPagamento,
};
