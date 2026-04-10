// src/routes/usuario.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');
const { listar, buscarPorId, criar, atualizar, remover, excluirDefinitivo, obterPin } = require('../controllers/usuario.controller');

router.use(autenticar);
router.get('/', exigirAdmin, listar);
router.get('/:id', exigirAdmin, buscarPorId);
router.get('/:id/pin', exigirAdmin, obterPin);
router.post('/', exigirAdmin, criar);
router.put('/:id', exigirAdmin, atualizar);
router.delete('/:id/definitivo', exigirAdmin, excluirDefinitivo);
router.delete('/:id', exigirAdmin, remover);

module.exports = router;
