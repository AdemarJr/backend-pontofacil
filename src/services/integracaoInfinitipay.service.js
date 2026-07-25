// Configuração InfinitePay (painel Super Admin + fallback env)
const prisma = require('../infra/prisma');

const CONFIG_ID = 'default';

function normalizeHandle(value) {
  return String(value || '').replace(/^\$/, '').trim();
}

function trimUrl(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}

function frontendBaseUrl() {
  return trimUrl(process.env.FRONTEND_URL) || 'http://localhost:3000';
}

function envApiPublicUrl() {
  return trimUrl(process.env.API_PUBLIC_URL || process.env.BACKEND_PUBLIC_URL);
}

function envHandle() {
  return normalizeHandle(process.env.INFINITEPAY_HANDLE);
}

async function ensureRow() {
  const existing = await prisma.integracaoInfinitipay.findUnique({ where: { id: CONFIG_ID } });
  if (existing) return existing;
  return prisma.integracaoInfinitipay.create({
    data: {
      id: CONFIG_ID,
      ativo: Boolean(envHandle()),
      handle: envHandle() || null,
      apiPublicUrl: envApiPublicUrl() || null,
    },
  });
}

function montarUrls(row) {
  const apiPublic = trimUrl(row.apiPublicUrl) || envApiPublicUrl();
  const webhookUrl =
    trimUrl(row.webhookUrl) ||
    (apiPublic ? `${apiPublic}/api/webhooks/infinitipay` : '');
  const redirectUrl =
    trimUrl(row.redirectUrl) || `${frontendBaseUrl()}/pagamento/retorno`;

  return { apiPublic, webhookUrl, redirectUrl };
}

async function obterConfigPainel() {
  const row = await ensureRow();
  const handlePainel = normalizeHandle(row.handle);
  const handleEnv = envHandle();
  const handleEfetivo = handlePainel || handleEnv;
  const { apiPublic, webhookUrl, redirectUrl } = montarUrls(row);

  return {
    id: row.id,
    ativo: row.ativo,
    handle: row.handle || '',
    apiPublicUrl: row.apiPublicUrl || '',
    webhookUrl: row.webhookUrl || '',
    redirectUrl: row.redirectUrl || '',
    updatedAt: row.updatedAt,
    updatedByEmail: row.updatedByEmail,
    // Campos calculados para exibição
    handleEfetivo,
    webhookUrlEfetiva: webhookUrl,
    redirectUrlEfetiva: redirectUrl,
    apiPublicUrlEfetiva: apiPublic,
    configurado: Boolean(handleEfetivo) && row.ativo,
    handleFonte: handlePainel ? 'painel' : handleEnv ? 'env' : null,
    docsUrl: 'https://www.infinitepay.io/checkout-documentacao',
  };
}

async function obterConfigOperacional() {
  const cfg = await obterConfigPainel();
  if (!cfg.configurado) {
    const err = new Error(
      'InfinitePay não configurada. Acesse Super Admin → Integrações e informe a InfiniteTag (handle) com a integração ativa.'
    );
    err.status = 503;
    err.code = 'INFINITEPAY_NOT_CONFIGURED';
    throw err;
  }
  return {
    handle: cfg.handleEfetivo,
    webhookUrl: cfg.webhookUrlEfetiva || undefined,
    redirectUrl: cfg.redirectUrlEfetiva,
  };
}

async function salvarConfig(body, superAdminEmail) {
  const row = await ensureRow();
  const data = {};

  if (body.ativo !== undefined) {
    data.ativo = body.ativo === true || body.ativo === 'true';
  }
  if (body.handle !== undefined) {
    const h = normalizeHandle(body.handle);
    data.handle = h || null;
  }
  if (body.apiPublicUrl !== undefined) {
    data.apiPublicUrl = trimUrl(body.apiPublicUrl) || null;
  }
  if (body.webhookUrl !== undefined) {
    data.webhookUrl = trimUrl(body.webhookUrl) || null;
  }
  if (body.redirectUrl !== undefined) {
    data.redirectUrl = trimUrl(body.redirectUrl) || null;
  }

  const handleFinal = normalizeHandle(data.handle !== undefined ? data.handle : row.handle) || envHandle();
  if (data.ativo && !handleFinal) {
    const err = new Error('Informe a InfiniteTag (handle) antes de ativar a integração.');
    err.status = 400;
    throw err;
  }

  data.updatedByEmail = superAdminEmail || null;

  await prisma.integracaoInfinitipay.update({
    where: { id: CONFIG_ID },
    data,
  });

  return obterConfigPainel();
}

module.exports = {
  obterConfigPainel,
  obterConfigOperacional,
  salvarConfig,
};
