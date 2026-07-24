-- CreateEnum
CREATE TYPE "ModoMarcacao" AS ENUM ('QUATRO_BATIDAS', 'DUAS_BATIDAS');

-- AlterTable tenants
ALTER TABLE "tenants" ADD COLUMN "modoMarcacao" "ModoMarcacao" NOT NULL DEFAULT 'QUATRO_BATIDAS';
ALTER TABLE "tenants" ADD COLUMN "proximoNsr" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tenants" ADD COLUMN "modoInviolavel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN "exigirCpfPis" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable usuarios
ALTER TABLE "usuarios" ADD COLUMN "consentimentoDadosEm" TIMESTAMP(3);
ALTER TABLE "usuarios" ADD COLUMN "consentimentoDadosVersao" TEXT;

-- AlterTable registros_ponto
ALTER TABLE "registros_ponto" ADD COLUMN "dataHoraUtc" TIMESTAMP(3);
ALTER TABLE "registros_ponto" ADD COLUMN "nsr" INTEGER;

-- Backfill NSR por tenant (ordem cronológica; inclui soft-deleted)
WITH numerados AS (
  SELECT
    id,
    "tenantId",
    ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "dataHora" ASC, "createdAt" ASC) AS nsr_calc
  FROM "registros_ponto"
)
UPDATE "registros_ponto" r
SET nsr = n.nsr_calc
FROM numerados n
WHERE r.id = n.id;

-- Backfill dataHoraUtc com dataHora existente
UPDATE "registros_ponto"
SET "dataHoraUtc" = "dataHora"
WHERE "dataHoraUtc" IS NULL;

-- Atualizar proximoNsr por tenant
UPDATE "tenants" t
SET "proximoNsr" = COALESCE(
  (SELECT MAX(nsr) + 1 FROM "registros_ponto" r WHERE r."tenantId" = t.id),
  1
);

-- CreateTable auditoria_eventos
CREATE TABLE "auditoria_eventos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "payloadAntes" JSONB,
    "payloadDepois" JSONB,
    "actorId" TEXT,
    "actorRole" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_eventos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auditoria_eventos_tenantId_createdAt_idx" ON "auditoria_eventos"("tenantId", "createdAt");
CREATE INDEX "auditoria_eventos_tenantId_entidade_entidadeId_idx" ON "auditoria_eventos"("tenantId", "entidade", "entidadeId");
CREATE INDEX "auditoria_eventos_tenantId_acao_idx" ON "auditoria_eventos"("tenantId", "acao");

ALTER TABLE "auditoria_eventos" ADD CONSTRAINT "auditoria_eventos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique NSR per tenant (only where nsr is set)
CREATE UNIQUE INDEX "registros_ponto_tenant_nsr_unique" ON "registros_ponto"("tenantId", "nsr") WHERE "nsr" IS NOT NULL;
