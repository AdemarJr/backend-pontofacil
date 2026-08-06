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

router.get('/colaboradores/:id/saldo-ferias', ctrl.saldoFeriasColaborador);

router.post('/ferias/calcular', ctrl.calcularFeriasPagamento);
router.get('/ferias/pagamentos', ctrl.listarFeriasPagamentos);
router.get('/ferias/pagamentos/:id/pdf', ctrl.downloadFeriasPagamentoPdf);

router.post('/decimo/calcular', ctrl.calcularDecimo);
router.get('/decimo/runs', ctrl.listarDecimoRuns);
router.get('/decimo/runs/:id', ctrl.obterDecimoRun);
router.get('/decimo/holerites/:id/pdf', ctrl.downloadDecimoHoleritePdf);

router.post('/adiantamento/calcular', ctrl.calcularAdiantamento);
router.get('/adiantamento/runs', ctrl.listarAdiantamentoRuns);
router.get('/adiantamento/runs/:id', ctrl.obterAdiantamentoRun);
router.get('/adiantamento/holerites/:id/pdf', ctrl.downloadAdiantamentoHoleritePdf);

router.post('/rescisao/calcular', ctrl.calcularRescisaoEndpoint);
router.get('/rescisao', ctrl.listarRescisoes);
router.get('/rescisao/:id/pdf', ctrl.downloadRescisaoPdf);

module.exports = router;
