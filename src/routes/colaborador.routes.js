// src/routes/colaborador.routes.js
const router = require('express').Router();
const { autenticar, exigirColaborador } = require('../middlewares/auth.middleware');
const {
  espelhoMeu,
  espelhoMeuExport,
  fechamentoStatus,
  fechamentoAprovar,
} = require('../controllers/relatorio.controller');
const {
  statusConsentimento,
  registrarConsentimento,
} = require('../controllers/colaborador.controller');

router.use(autenticar, exigirColaborador);

router.get('/consentimento', statusConsentimento);
router.post('/consentimento', registrarConsentimento);

// Espelho mensal do próprio colaborador
router.get('/espelho', espelhoMeu);
router.get('/espelho/export', espelhoMeuExport); // ?format=csv|xlsx|pdf

// Fechamento mensal (aceite/assinatura)
router.get('/espelho/fechamento', fechamentoStatus); // ?mes&ano
router.post('/espelho/fechamento', fechamentoAprovar); // { mes, ano, assinaturaDataUrl?, assinaturaStrokes?, deviceId? }

module.exports = router;

