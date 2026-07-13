// src/shared/middlewares/exigirFeature.js
const { lerFeaturesDoTenant } = require('../tenantFeatures');

const FEATURE_LABELS = {
  payroll: 'Módulo de Folha de Pagamento',
};

function exigirFeature(featureKey) {
  return async (req, res, next) => {
    try {
      if (req.isSuperAdmin) return next();
      if (!req.tenantId) {
        return res.status(403).json({ error: 'Tenant não identificado' });
      }

      const features = await lerFeaturesDoTenant(req.tenantId);

      const enabled = featureKey === 'payroll' && features.payrollModuleEnabled === true;

      if (!enabled) {
        return res.status(403).json({
          error: `${FEATURE_LABELS[featureKey] || featureKey} não está habilitado para sua empresa.`,
          code: 'FEATURE_DISABLED',
          feature: featureKey,
        });
      }

      req.tenantFeatures = features;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { exigirFeature };
