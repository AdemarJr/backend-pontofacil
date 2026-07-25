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
  solicitarAssinaturaEspelho,
  exportPreAfd,
  exportAej,
  listarAuditoria,
  exportAuditoriaCsv,
} = require('../controllers/relatorio.controller');

router.use(autenticar, exigirAdmin);
router.get('/espelho', espelhoPonto);
router.get('/espelho/export', espelhoExport); // ?format=csv|xlsx|pdf
router.post('/espelho/solicitar-assinatura', solicitarAssinaturaEspelho);
router.get('/banco-horas', bancoHorasResumo);
router.get('/resumo-dia', resumoDia);
router.get('/afd/export', exportPreAfd);
router.get('/aej/export', exportAej);
router.get('/auditoria', listarAuditoria);
router.get('/auditoria/export', exportAuditoriaCsv);
router.post('/ajuste', ajustarPonto);
router.post('/inserir', inserirPontoManual);
router.get('/solicitacoes-ajuste', listarSolicitacoesAjuste);
router.post('/solicitacoes-ajuste/:id/decidir', decidirSolicitacaoAjuste);

module.exports = router;
