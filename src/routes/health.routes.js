// src/routes/health.routes.js
const router = require('express').Router();
const https = require('https');

/**
 * GET /api/health/egress-ip
 *
 * Descobre o IP público de saída (egress IP) do Railway fazendo uma
 * requisição para api.ipify.org e registra o resultado nos logs com o
 * prefixo [EGRESS_IP] para facilitar a correlação com os logs do Hostinger.
 */
router.get('/egress-ip', (req, res) => {
  https
    .get('https://api.ipify.org?format=json', (ipifyRes) => {
      let raw = '';

      ipifyRes.on('data', (chunk) => {
        raw += chunk;
      });

      ipifyRes.on('end', () => {
        try {
          const { ip } = JSON.parse(raw);
          console.log(`[EGRESS_IP] IP público de saída do Railway: ${ip}`);
          return res.json({
            ok: true,
            egressIp: ip,
            message: 'IP de saída registrado nos logs do servidor.',
          });
        } catch (parseErr) {
          console.error('[EGRESS_IP] Falha ao parsear resposta do ipify:', parseErr.message);
          return res.status(502).json({
            ok: false,
            error: 'Resposta inválida do serviço de IP externo.',
          });
        }
      });
    })
    .on('error', (err) => {
      console.error('[EGRESS_IP] Falha ao consultar ip público:', err.message);
      return res.status(502).json({
        ok: false,
        error: 'Não foi possível consultar o IP público de saída.',
        detail: err.message,
      });
    });
});

module.exports = router;
