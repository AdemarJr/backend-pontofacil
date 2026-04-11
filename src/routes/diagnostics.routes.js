// src/routes/diagnostics.routes.js
const router = require('express').Router();
const https = require('https');

/**
 * GET /api/check-ip
 * Descobre o IP público de saída (egress IP) do Railway fazendo uma requisição
 * para api.ipify.org e registra o resultado nos logs com prefixo [EGRESS_IP].
 * Útil para diagnosticar bloqueios de IP em servidores SMTP (ex.: Hostinger).
 */
router.get('/check-ip', (req, res) => {
  https.get('https://api.ipify.org?format=json', (ipifyRes) => {
    let data = '';

    ipifyRes.on('data', (chunk) => {
      data += chunk;
    });

    ipifyRes.on('end', () => {
      try {
        const { ip } = JSON.parse(data);
        console.log(`[EGRESS_IP] IP público de saída do Railway: ${ip}`);
        return res.status(200).json({
          egressIp: ip,
          message: 'IP de saída registrado nos logs',
        });
      } catch (parseErr) {
        console.error('[EGRESS_IP] Erro ao parsear resposta do ipify:', parseErr.message);
        return res.status(502).json({ error: 'Resposta inválida do serviço de IP.' });
      }
    });
  }).on('error', (err) => {
    console.error('[EGRESS_IP] Falha ao consultar api.ipify.org:', err.message);
    return res.status(502).json({ error: 'Não foi possível consultar o IP de saída.', detail: err.message });
  });
});

module.exports = router;
