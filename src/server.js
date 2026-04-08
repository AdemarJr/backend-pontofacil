// src/server.js
const path = require('path');
const envFile =
  process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
require('dotenv').config({ path: path.join(__dirname, '..', envFile) });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth.routes');
const tenantRoutes = require('./routes/tenant.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const pontoRoutes = require('./routes/ponto.routes');
const relatorioRoutes = require('./routes/relatorio.routes');
const superAdminRoutes = require('./routes/superadmin.routes');

const app = express();
const PORT = process.env.PORT || 3001;

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

// ---- ROTAS ----
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/ponto', pontoLimiter, pontoRoutes);
app.use('/api/relatorios', relatorioRoutes);
app.use('/api/super-admin', superAdminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Handler de erros global
app.use((err, req, res, next) => {
  console.error('Erro:', err.message);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

app.listen(PORT, () => {
  console.log(`🚀 PontoFácil Backend rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV}`);
});

module.exports = app;
