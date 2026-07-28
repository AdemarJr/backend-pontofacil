-- Benefícios no colaborador + parâmetros de desconto na folha

ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "usaVt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "valorVtMensal" DECIMAL(12,2);
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "descontoVaMensal" DECIMAL(12,2);
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "descontoPlanoSaudeMensal" DECIMAL(12,2);

ALTER TABLE "folha_config" ADD COLUMN IF NOT EXISTS "vtPercentMax" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "folha_config" ADD COLUMN IF NOT EXISTS "vtProporcionalFaltas" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "folha_config" ADD COLUMN IF NOT EXISTS "descontarAtrasos" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "folha_config" ADD COLUMN IF NOT EXISTS "descontoAtrasoDiarioPercent" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE "folha_config" ADD COLUMN IF NOT EXISTS "descontarIntervaloInsuficiente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "folha_config" ADD COLUMN IF NOT EXISTS "descontoIntervaloDiarioPercent" INTEGER NOT NULL DEFAULT 25;
