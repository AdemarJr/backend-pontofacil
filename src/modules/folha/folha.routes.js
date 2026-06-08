// src/modules/folha/folha.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin } = require('../../middlewares/auth.middleware');
const { exigirFeature } = require('../../shared/middlewares/exigirFeature');
const ctrl = require('./folha.controller');

router.use(autenticar, exigirAdmin, exigirFeature('payroll'));

router.get('/config', ctrl.getConfig);
router.put('/config', ctrl.putConfig);
router.post('/calcular', ctrl.calcular);
router.get('/runs', ctrl.listarRuns);
router.get('/runs/:id', ctrl.obterRun);
router.post('/runs/:id/fechar', ctrl.fechar);
router.get('/holerites/:id/pdf', ctrl.downloadHoleritePdf);
router.post('/runs/:id/cnab', ctrl.exportCnab);

module.exports = router;
