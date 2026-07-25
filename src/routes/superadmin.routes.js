// src/routes/superadmin.routes.js
const router = require('express').Router();
const { autenticar, exigirSuperAdmin } = require('../middlewares/auth.middleware');
const {
  listarTenants,
  criarTenant,
  criarAdminTenant,
  resetSenhaAdminTenant,
  reenviarConviteAdminTenant,
  atualizarTenant,
  atualizarFeatures,
  atualizarContrato,
  atualizarStatus,
  stats,
  limparRegistrosTenant,
} = require('../controllers/superadmin.controller');
const { listar, buscarPorId, criar, atualizar, remover } = require('../controllers/plano.controller');
const {
  criarCobrancaTenant,
  listarPagamentosTenant,
} = require('../controllers/pagamento.controller');
const {
  obterInfinitipay,
  salvarInfinitipay,
  testarInfinitipay,
} = require('../controllers/integracao.controller');

router.use(autenticar, exigirSuperAdmin);

router.get('/integracoes/infinitipay', obterInfinitipay);
router.put('/integracoes/infinitipay', salvarInfinitipay);
router.post('/integracoes/infinitipay/testar', testarInfinitipay);

router.get('/plans', listar);
router.get('/plans/:id', buscarPorId);
router.post('/plans', criar);
router.put('/plans/:id', atualizar);
router.delete('/plans/:id', remover);

router.get('/tenants', listarTenants);
router.post('/tenants', criarTenant);
router.post('/tenants/:id/admin', criarAdminTenant);
router.post('/tenants/:id/admin/:adminId/reset-senha', resetSenhaAdminTenant);
router.post('/tenants/:id/admin/:adminId/reenviar-convite', reenviarConviteAdminTenant);
router.put('/tenants/:id', atualizarTenant);
router.put('/tenants/:id/features', atualizarFeatures);
router.put('/tenants/:id/contrato', atualizarContrato);
router.put('/tenants/:id/status', atualizarStatus);
router.post('/tenants/:id/limpar-registros', limparRegistrosTenant);
router.post('/tenants/:id/cobranca-plano', criarCobrancaTenant);
router.get('/tenants/:id/pagamentos', listarPagamentosTenant);
router.get('/stats', stats);

module.exports = router;
