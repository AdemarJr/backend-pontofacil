-- =============================================================================
-- MIGRATION ADITIVA — segura para produção
-- - Só ADICIONA colunas (nullable ou com DEFAULT) e novas tabelas vazias.
-- - NÃO remove, NÃO altera valores de registros existentes.
-- - Tenants atuais: contractStartDate/contractEndDate ficam NULL → sem expiração.
-- =============================================================================

-- CreateEnum
CREATE TYPE "TipoContrato" AS ENUM ('CLT', 'ESTAGIO', 'PJ');

-- CreateEnum
CREATE TYPE "TipoContaBancaria" AS ENUM ('CORRENTE', 'POUPANCA');

-- CreateEnum
CREATE TYPE "ModoBancoHoras" AS ENUM ('COMPENSAR', 'PAGAR');

-- CreateEnum
CREATE TYPE "StatusFolhaRun" AS ENUM ('RASCUNHO', 'CALCULADA', 'FECHADA', 'PAGA');

-- AlterTable tenants
ALTER TABLE "tenants" ADD COLUMN "contractStartDate" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "contractEndDate" TIMESTAMP(3);

-- AlterTable usuarios
ALTER TABLE "usuarios" ADD COLUMN "cpf" TEXT;
ALTER TABLE "usuarios" ADD COLUMN "pis" TEXT;
ALTER TABLE "usuarios" ADD COLUMN "matricula" TEXT;
ALTER TABLE "usuarios" ADD COLUMN "tipoContrato" "TipoContrato" NOT NULL DEFAULT 'CLT';
ALTER TABLE "usuarios" ADD COLUMN "salarioBase" DECIMAL(12,2);
ALTER TABLE "usuarios" ADD COLUMN "categoriaProfissional" TEXT;
ALTER TABLE "usuarios" ADD COLUMN "dependentesIrrf" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "usuarios" ADD COLUMN "contaBanco" TEXT;
ALTER TABLE "usuarios" ADD COLUMN "contaAgencia" TEXT;
ALTER TABLE "usuarios" ADD COLUMN "contaNumero" TEXT;
ALTER TABLE "usuarios" ADD COLUMN "contaTipo" "TipoContaBancaria";

-- CreateTable tenant_features
CREATE TABLE "tenant_features" (
    "tenantId" TEXT NOT NULL,
    "payrollModuleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_features_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable folha_config
CREATE TABLE "folha_config" (
    "tenantId" TEXT NOT NULL,
    "modoBancoHoras" "ModoBancoHoras" NOT NULL DEFAULT 'COMPENSAR',
    "heDiaUtilPercent" INTEGER NOT NULL DEFAULT 50,
    "heDomingoFeriadoPercent" INTEGER NOT NULL DEFAULT 100,
    "adicionalNoturnoPercent" INTEGER NOT NULL DEFAULT 20,
    "toleranciaAtrasoMin" INTEGER,
    "pagarDSR" BOOLEAN NOT NULL DEFAULT true,
    "permitirFolhaSemAssinatura" BOOLEAN NOT NULL DEFAULT false,
    "tabelasVersao" TEXT,
    "tabelasSnapshot" JSONB,
    "bancoCodigo" TEXT,
    "bancoAgencia" TEXT,
    "bancoConta" TEXT,
    "bancoConvenio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folha_config_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable folha_runs
CREATE TABLE "folha_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mes" INTEGER NOT NULL,
    "ano" INTEGER NOT NULL,
    "status" "StatusFolhaRun" NOT NULL DEFAULT 'RASCUNHO',
    "calculadaEm" TIMESTAMP(3),
    "fechadaEm" TIMESTAMP(3),
    "fechadaPorId" TEXT,
    "bloqueadaPorPendencias" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folha_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable holerites
CREATE TABLE "holerites" (
    "id" TEXT NOT NULL,
    "folhaRunId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "proventos" JSONB NOT NULL,
    "descontos" JSONB NOT NULL,
    "bases" JSONB NOT NULL,
    "liquido" DECIMAL(12,2) NOT NULL,
    "pdfKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holerites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "folha_runs_tenantId_mes_ano_key" ON "folha_runs"("tenantId", "mes", "ano");
CREATE INDEX "folha_runs_tenantId_mes_ano_idx" ON "folha_runs"("tenantId", "mes", "ano");
CREATE UNIQUE INDEX "holerites_folhaRunId_usuarioId_key" ON "holerites"("folhaRunId", "usuarioId");
CREATE INDEX "holerites_folhaRunId_idx" ON "holerites"("folhaRunId");
CREATE INDEX "holerites_usuarioId_idx" ON "holerites"("usuarioId");

-- AddForeignKey
ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folha_config" ADD CONSTRAINT "folha_config_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folha_runs" ADD CONSTRAINT "folha_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folha_runs" ADD CONSTRAINT "folha_runs_fechadaPorId_fkey" FOREIGN KEY ("fechadaPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "holerites" ADD CONSTRAINT "holerites_folhaRunId_fkey" FOREIGN KEY ("folhaRunId") REFERENCES "folha_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "holerites" ADD CONSTRAINT "holerites_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
