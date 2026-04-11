// src/routes/comprovanteAusencia.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin, exigirColaborador } = require('../middlewares/auth.middleware');
const {
  criar,
  listarMinhas,
  listar,
  obter,
  decidir,
} = require('../controllers/comprovanteAusencia.controller');

router.get('/minhas', autenticar, exigirColaborador, listarMinhas);
router.post('/', autenticar, exigirColaborador, criar);
router.get('/', autenticar, exigirAdmin, listar);
router.put('/:id/decidir', autenticar, exigirAdmin, decidir);
router.get('/:id', autenticar, obter);

module.exports = router;
