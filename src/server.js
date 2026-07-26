// src/server.js
// reinício: Prisma client com isentoGeofence
const path = require('path');
const envFile =
  process.env.NODE_ENV === 'production'
    ? (['.env.production', '.env-production'].find((f) =>
        require('fs').existsSync(path.join(__dirname, '..', f))
      ) || '.env.production')
    : '.env';
require('dotenv').config({ path: path.join(__dirname, '..', envFile) });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth.routes');
const tenantRoutes = require('./routes/tenant.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const pontoRoutes = require('./routes/ponto.routes');
const relatorioRoutes = require('./routes/relatorio.routes');
const escalaRoutes = require('./routes/escala.routes');
const localRoutes = require('./routes/local.routes');
const superAdminRoutes = require('./routes/superadmin.routes');
const comprovanteAusenciaRoutes = require('./routes/comprovanteAusencia.routes');
const feriadoRoutes = require('./routes/feriado.routes');
const feriasRoutes = require('./routes/ferias.routes');
const colaboradorRoutes = require('./routes/colaborador.routes');
const folhaRoutes = require('./modules/folha/folha.routes');
const pagamentoRoutes = require('./routes/pagamento.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// Importante: atrás de proxy (Railway/Easypanel/Nginx), precisamos confiar no X-Forwarded-For
// para rate-limit e auditoria (req.ip). Deve rodar ANTES de qualquer rateLimit/rotas.
const { aplicarTrustProxy } = require('./middlewares/trustProxy.middleware');
aplicarTrustProxy(app);

function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/\/$/, '');
}

// Origens permitidas: env + fallback (evita falha se FRONTEND_URL tiver "/" no fim ou só uma das vars no Easypanel)
const envOriginStrings = [
  process.env.CORS_ORIGINS,
  process.env.FRONTEND_URL,
].filter(Boolean);

const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const corsOrigins = [
  ...new Set(
    [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3002',
      'http://127.0.0.1:3002',
      'https://crm-app-pontofacil-frontend.9nb5f0.easypanel.host',
      'https://frontend-pontofacil.vercel.app',
      'https://pontofacil.digital',
      'https://www.pontofacil.digital',
      ...envOriginStrings.join(',').split(',').map(normalizeOrigin),
      ...extraOrigins,
    ].filter(Boolean)
  ),
];

/** Permite previews/deploys em *.vercel.app quando CORS_ALLOW_VERCEL=1 (opcional). */
function isVercelPreviewOrigin(origin) {
  if (process.env.CORS_ALLOW_VERCEL !== '1') return false;
  const n = normalizeOrigin(origin);
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(n);
}

// ---- SEGURANÇA ----
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalized = normalizeOrigin(origin);
      if (corsOrigins.includes(normalized)) return callback(null, true);
      if (isVercelPreviewOrigin(origin)) return callback(null, true);
      console.warn('[CORS] Origem bloqueada:', origin, '| Permitidas:', corsOrigins.join(', '));
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate limiting global (preflight não conta)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 300,
    skip: (req) => req.method === 'OPTIONS',
    message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
  })
);

// Rate limiting rigoroso para registro de ponto (anti-fraude)
const pontoLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  message: { error: 'Limite de registros atingido. Aguarde 1 minuto.' }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---- ROTAS ----
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/ponto', pontoLimiter, pontoRoutes);
app.use('/api/relatorios', relatorioRoutes);
app.use('/api/escalas', escalaRoutes);
app.use('/api/locais-registro', localRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/comprovantes-ausencia', comprovanteAusenciaRoutes);
app.use('/api/feriados', feriadoRoutes);
app.use('/api/ferias', feriasRoutes);
app.use('/api/colaborador', colaboradorRoutes);
app.use('/api/folha', folhaRoutes);
app.use('/api/webhooks', pagamentoRoutes);
app.use('/api/pagamentos', pagamentoRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rotas de diagnóstico — apenas desenvolvimento ou ENABLE_DEBUG_ROUTES=1
const debugRoutesEnabled =
  process.env.NODE_ENV !== 'production' || process.env.ENABLE_DEBUG_ROUTES === '1';

if (debugRoutesEnabled) {
  app.get('/api/check-ip', (req, res) => {
    const https = require('https');
    https.get('https://api.ipify.org?format=json', (ipifyRes) => {
      let data = '';
      ipifyRes.on('data', (chunk) => { data += chunk; });
      ipifyRes.on('end', () => {
        try {
          const { ip } = JSON.parse(data);
          console.log(`[EGRESS_IP] IP público de saída: ${ip}`);
          return res.status(200).json({ egressIp: ip, message: 'IP de saída registrado nos logs' });
        } catch (parseErr) {
          console.error('[EGRESS_IP] Erro ao parsear resposta:', parseErr.message);
          return res.status(502).json({ error: 'Resposta inválida do serviço de IP.' });
        }
      });
    }).on('error', (err) => {
      console.error('[EGRESS_IP] Falha ao consultar api.ipify.org:', err.message);
      return res.status(502).json({ error: 'Não foi possível consultar o IP de saída.' });
    });
  });

  app.get('/api/test-smtp-connection', (req, res) => {
    const net = require('net');
    const SMTP_HOST = 'smtp.hostinger.com';
    const PORTS = [587, 465, 2525];
    const TIMEOUT_MS = 10000;

    function testPort(port) {
      return new Promise((resolve) => {
        const socket = net.createConnection({ host: SMTP_HOST, port });
        let settled = false;

        const finish = (result) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(result);
        };

        const timer = setTimeout(() => {
          finish({ connected: false, message: 'Connection timeout' });
        }, TIMEOUT_MS);

        socket.on('connect', () => {
          clearTimeout(timer);
          finish({ connected: true, message: 'Conexão bem-sucedida' });
        });

        socket.on('error', (err) => {
          clearTimeout(timer);
          const message = err.code === 'ECONNREFUSED' ? 'Connection refused' : err.message;
          finish({ connected: false, message });
        });
      });
    }

    Promise.all(PORTS.map((port) => testPort(port).then((result) => [port, result])))
      .then((results) => {
        const tests = Object.fromEntries(results);
        return res.status(200).json({ host: SMTP_HOST, tests });
      })
      .catch((err) => {
        return res.status(500).json({ error: 'Erro ao executar testes SMTP.' });
      });
  });

  app.get('/api/test-smtp-simple', (req, res) => {
    const net = require('net');
    const SMTP_HOST = 'smtp.hostinger.com';
    const PORTS = [587, 465, 2525];
    const TIMEOUT_MS = 5000;

    function testPort(port) {
      return new Promise((resolve) => {
        const socket = net.createConnection({ host: SMTP_HOST, port });
        let settled = false;

        const finish = (status) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve({ port, status });
        };

        const timer = setTimeout(() => finish('TIMEOUT'), TIMEOUT_MS);

        socket.on('connect', () => {
          clearTimeout(timer);
          finish('CONNECTED');
        });

        socket.on('error', (err) => {
          clearTimeout(timer);
          finish(err.code === 'ECONNREFUSED' ? 'REFUSED' : 'ERROR');
        });
      });
    }

    Promise.all(PORTS.map((port) => testPort(port)))
      .then((results) => {
        const resultMap = Object.fromEntries(results.map(({ port, status }) => [port, status]));
        return res.status(200).json({ host: SMTP_HOST, results: resultMap });
      })
      .catch(() => res.status(500).json({ error: 'Erro ao executar teste SMTP simples.' }));
  });
}

// Handler de erros global
app.use((err, req, res, next) => {
  console.error('Erro:', err.message);
  // Prisma: schema desatualizado (coluna não existe) costuma gerar erro em runtime após deploy sem migrate.
  const msg = String(err?.message || '');
  const prismaCode = err?.code;
  const schemaOutdated =
    prismaCode === 'P2021' ||
    prismaCode === 'P2022' ||
    /does not exist/i.test(msg);
  if (schemaOutdated) {
    return res.status(500).json({
      error:
        'Banco de dados desatualizado para este backend. Rode `npx prisma migrate deploy` no Railway e tente novamente.',
      code: 'DB_SCHEMA_OUTDATED',
    });
  }
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const { iniciarJobVerificacaoContratos } = require('./services/contractExpiry.service');

app.listen(PORT, () => {
  console.log(`🚀 PontoFácil Backend rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV}`);
  iniciarJobVerificacaoContratos();
  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    console.error('⚠️  JWT_SECRET ou JWT_REFRESH_SECRET ausentes — /api/auth/login retornará erro 500.');
  }
  if (!process.env.DIRECT_URL) {
    console.warn('⚠️  DIRECT_URL ausente — migrações Prisma e alguns comandos podem falhar.');
  }
});

module.exports = app;
