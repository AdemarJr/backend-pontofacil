// Integração InfinitePay Checkout (links de pagamento Pix/cartão)
// Docs: https://www.infinitepay.io/checkout-documentacao

const API_BASE = 'https://api.checkout.infinitepay.io';

function getHandle() {
  const raw = process.env.INFINITEPAY_HANDLE || '';
  return raw.replace(/^\$/, '').trim();
}

function assertInfinitipayConfig() {
  const handle = getHandle();
  if (!handle) {
    const err = new Error(
      'Pagamentos InfinitePay não configurados. Defina INFINITEPAY_HANDLE no servidor (sua InfiniteTag sem o $).'
    );
    err.status = 503;
    err.code = 'INFINITEPAY_NOT_CONFIGURED';
    throw err;
  }
  return handle;
}

function buildWebhookUrl() {
  const explicit = process.env.INFINITEPAY_WEBHOOK_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const apiBase = (process.env.API_PUBLIC_URL || process.env.BACKEND_PUBLIC_URL || '').replace(/\/+$/, '');
  if (apiBase) return `${apiBase}/api/webhooks/infinitipay`;
  return undefined;
}

function buildRedirectUrl() {
  const front = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${front}/pagamento/retorno`;
}

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
 * @param {{ orderNsu: string, items: Array<{quantity:number, price:number, description:string}>, customer?: object, redirectUrl?: string, webhookUrl?: string }} params
 */
async function criarLinkCheckout(params) {
  const handle = assertInfinitipayConfig();
  const payload = {
    handle,
    order_nsu: params.orderNsu,
    items: params.items,
    redirect_url: params.redirectUrl || buildRedirectUrl(),
    webhook_url: params.webhookUrl || buildWebhookUrl(),
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
  const handle = assertInfinitipayConfig();
  const res = await fetch(`${API_BASE}/payment_check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      handle,
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug,
    }),
  });
  return parseJsonResponse(res);
}

module.exports = {
  getHandle,
  assertInfinitipayConfig,
  buildWebhookUrl,
  buildRedirectUrl,
  criarLinkCheckout,
  consultarPagamento,
};
