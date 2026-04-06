// src/server.js
require('dotenv').config();
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

// ---- SEGURANÇA ----
app.use(helmet());

// CORS: FRONTEND_URL ou lista em CORS_ORIGINS (separada por vírgula), ex.: produção + localhost
const corsOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    console.warn('[CORS] Origem bloqueada:', origin, '| Permitidas:', corsOrigins.join(', '));
    return callback(new Error('Origem não permitida pelo CORS'));
  },
  credentials: true,
}));

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' }
}));

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
