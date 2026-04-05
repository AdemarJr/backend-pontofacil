// src/routes/superadmin.routes.js
const router = require('express').Router();
const { autenticar, exigirSuperAdmin } = require('../middlewares/auth.middleware');
const {
  listarTenants,
  criarTenant,
  criarAdminTenant,
  atualizarTenant,
  atualizarStatus,
  stats,
} = require('../controllers/superadmin.controller');

router.use(autenticar, exigirSuperAdmin);

router.get('/tenants', listarTenants);
router.post('/tenants', criarTenant);
router.post('/tenants/:id/admin', criarAdminTenant);
router.put('/tenants/:id', atualizarTenant);
router.put('/tenants/:id/status', atualizarStatus);
router.get('/stats', stats);

module.exports = router;
