-- Migration ADITIVA (segura para produção):
-- - Apenas adiciona coluna nullable; tenants existentes permanecem sem limite de contrato.
-- - Não altera nem remove dados existentes.

-- CreateEnum
CREATE TYPE "PeriodoContratoTenant" AS ENUM ('MENSAL', 'SEMESTRAL', 'ANUAL');

-- AlterTable (nullable — não afeta registros atuais)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "periodoContrato" "PeriodoContratoTenant";
