-- AlterTable
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "fusoHorario" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
