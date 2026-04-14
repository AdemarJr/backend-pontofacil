-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "StatusSolicitacaoAjustePonto" AS ENUM ('PENDENTE', 'ATENDIDA', 'REJEITADA');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "solicitacoes_ajuste_ponto" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "dia" TEXT NOT NULL,
  "tipo" "TipoPonto" NOT NULL,
  "dataHoraSugerida" TIMESTAMP(3),
  "justificativa" TEXT NOT NULL,
  "status" "StatusSolicitacaoAjustePonto" NOT NULL DEFAULT 'PENDENTE',
  "respondidoPorId" TEXT,
  "respondidoEm" TIMESTAMP(3),
  "respostaAdmin" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "solicitacoes_ajuste_ponto_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "solicitacoes_ajuste_ponto_tenantId_usuarioId_dia_idx"
  ON "solicitacoes_ajuste_ponto"("tenantId", "usuarioId", "dia");

CREATE INDEX IF NOT EXISTS "solicitacoes_ajuste_ponto_tenantId_status_idx"
  ON "solicitacoes_ajuste_ponto"("tenantId", "status");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "solicitacoes_ajuste_ponto"
    ADD CONSTRAINT "solicitacoes_ajuste_ponto_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solicitacoes_ajuste_ponto"
    ADD CONSTRAINT "solicitacoes_ajuste_ponto_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "solicitacoes_ajuste_ponto"
    ADD CONSTRAINT "solicitacoes_ajuste_ponto_respondidoPorId_fkey"
    FOREIGN KEY ("respondidoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

