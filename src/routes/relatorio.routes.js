// src/routes/relatorio.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');
const {
  espelhoPonto,
  espelhoExport,
  bancoHorasResumo,
  resumoDia,
  ajustarPonto,
  inserirPontoManual,
  listarSolicitacoesAjuste,
  decidirSolicitacaoAjuste,
} = require('../controllers/relatorio.controller');

router.use(autenticar, exigirAdmin);
router.get('/espelho', espelhoPonto);
router.get('/espelho/export', espelhoExport); // ?format=csv|xlsx|pdf
router.get('/banco-horas', bancoHorasResumo);
router.get('/resumo-dia', resumoDia);
router.post('/ajuste', ajustarPonto);
router.post('/inserir', inserirPontoManual);
router.get('/solicitacoes-ajuste', listarSolicitacoesAjuste);
router.post('/solicitacoes-ajuste/:id/decidir', decidirSolicitacaoAjuste);

module.exports = router;
