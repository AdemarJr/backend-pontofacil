-- Planos comerciais + pagamentos Infinitipay

CREATE TYPE "StatusPagamentoPlano" AS ENUM ('PENDENTE', 'PAGO', 'CANCELADO', 'EXPIRADO');

CREATE TABLE "planos_comerciais" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "valorCentavos" INTEGER NOT NULL,
    "maxColaboradores" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planos_comerciais_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pagamentos_plano" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planoComercialId" TEXT NOT NULL,
    "orderNsu" TEXT NOT NULL,
    "invoiceSlug" TEXT,
    "transactionNsu" TEXT,
    "status" "StatusPagamentoPlano" NOT NULL DEFAULT 'PENDENTE',
    "valorCentavos" INTEGER NOT NULL,
    "checkoutUrl" TEXT,
    "receiptUrl" TEXT,
    "captureMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_plano_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pagamentos_plano_orderNsu_key" ON "pagamentos_plano"("orderNsu");
CREATE INDEX "pagamentos_plano_tenantId_createdAt_idx" ON "pagamentos_plano"("tenantId", "createdAt");
CREATE INDEX "pagamentos_plano_status_idx" ON "pagamentos_plano"("status");

ALTER TABLE "tenants" ADD COLUMN "planoComercialId" TEXT;

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_planoComercialId_fkey"
  FOREIGN KEY ("planoComercialId") REFERENCES "planos_comerciais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pagamentos_plano" ADD CONSTRAINT "pagamentos_plano_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pagamentos_plano" ADD CONSTRAINT "pagamentos_plano_planoComercialId_fkey"
  FOREIGN KEY ("planoComercialId") REFERENCES "planos_comerciais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Planos padrão (equivalentes ao enum legado)
INSERT INTO "planos_comerciais" ("id", "nome", "descricao", "valorCentavos", "maxColaboradores", "ativo", "ordem", "createdAt", "updatedAt") VALUES
  ('11111111-1111-1111-1111-111111111101', 'Básico', 'Até 10 colaboradores', 9900, 10, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('11111111-1111-1111-1111-111111111102', 'Profissional', 'Até 50 colaboradores', 19900, 50, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('11111111-1111-1111-1111-111111111103', 'Enterprise', 'Colaboradores ilimitados', 49900, NULL, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE "tenants" SET "planoComercialId" = '11111111-1111-1111-1111-111111111101' WHERE "plano" = 'BASICO' AND "planoComercialId" IS NULL;
UPDATE "tenants" SET "planoComercialId" = '11111111-1111-1111-1111-111111111102' WHERE "plano" = 'PROFISSIONAL' AND "planoComercialId" IS NULL;
UPDATE "tenants" SET "planoComercialId" = '11111111-1111-1111-1111-111111111103' WHERE "plano" = 'ENTERPRISE' AND "planoComercialId" IS NULL;
UPDATE "tenants" SET "planoComercialId" = '11111111-1111-1111-1111-111111111101' WHERE "planoComercialId" IS NULL;
