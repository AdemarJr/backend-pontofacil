-- Soft-delete fields for registros_ponto (admin audit)
ALTER TABLE "registros_ponto"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletedById" TEXT,
ADD COLUMN IF NOT EXISTS "deletedMotivo" TEXT;

DO $$ BEGIN
  ALTER TABLE "registros_ponto"
    ADD CONSTRAINT "registros_ponto_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "registros_ponto_tenantId_deletedAt_idx"
  ON "registros_ponto"("tenantId", "deletedAt");

