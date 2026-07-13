// src/routes/comprovanteAusencia.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin, exigirColaborador } = require('../middlewares/auth.middleware');
const {
  criar,
  listarMinhas,
  listar,
  obter,
  decidir,
  registrarFolga,
  atualizarFolga,
  removerFolga,
} = require('../controllers/comprovanteAusencia.controller');

router.get('/minhas', autenticar, exigirColaborador, listarMinhas);
router.post('/', autenticar, exigirColaborador, criar);
router.post('/folga', autenticar, exigirAdmin, registrarFolga);
router.get('/', autenticar, exigirAdmin, listar);
router.put('/:id/decidir', autenticar, exigirAdmin, decidir);
router.put('/:id/folga', autenticar, exigirAdmin, atualizarFolga);
router.delete('/:id/folga', autenticar, exigirAdmin, removerFolga);
router.get('/:id', autenticar, obter);

module.exports = router;
