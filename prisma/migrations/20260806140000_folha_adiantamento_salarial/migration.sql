-- Adiantamento salarial (meio do mês) + config

ALTER TABLE "folha_config" ADD COLUMN IF NOT EXISTS "adiantamentoPercent" INTEGER NOT NULL DEFAULT 40;
ALTER TABLE "folha_config" ADD COLUMN IF NOT EXISTS "descontarAdiantamentoNaFolha" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "adiantamento_salarial_runs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "mes" INTEGER NOT NULL,
  "ano" INTEGER NOT NULL,
  "percent" INTEGER NOT NULL DEFAULT 40,
  "status" "StatusFolhaRun" NOT NULL DEFAULT 'CALCULADA',
  "calculadaEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "adiantamento_salarial_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "adiantamento_salarial_runs_tenantId_mes_ano_key"
  ON "adiantamento_salarial_runs"("tenantId", "mes", "ano");

CREATE TABLE IF NOT EXISTS "adiantamento_salarial_holerites" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "percent" INTEGER NOT NULL,
  "proventos" JSONB NOT NULL,
  "descontos" JSONB NOT NULL,
  "bases" JSONB NOT NULL,
  "liquido" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "adiantamento_salarial_holerites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "adiantamento_salarial_holerites_runId_usuarioId_key"
  ON "adiantamento_salarial_holerites"("runId", "usuarioId");

ALTER TABLE "adiantamento_salarial_runs" DROP CONSTRAINT IF EXISTS "adiantamento_salarial_runs_tenantId_fkey";
ALTER TABLE "adiantamento_salarial_runs" ADD CONSTRAINT "adiantamento_salarial_runs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adiantamento_salarial_holerites" DROP CONSTRAINT IF EXISTS "adiantamento_salarial_holerites_runId_fkey";
ALTER TABLE "adiantamento_salarial_holerites" ADD CONSTRAINT "adiantamento_salarial_holerites_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "adiantamento_salarial_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adiantamento_salarial_holerites" DROP CONSTRAINT IF EXISTS "adiantamento_salarial_holerites_usuarioId_fkey";
ALTER TABLE "adiantamento_salarial_holerites" ADD CONSTRAINT "adiantamento_salarial_holerites_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
