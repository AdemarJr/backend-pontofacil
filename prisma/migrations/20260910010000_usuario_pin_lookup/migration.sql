-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "pinLookup" TEXT;

-- CreateIndex (PostgreSQL permite vários NULL em UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_tenantId_pinLookup_key" ON "usuarios"("tenantId", "pinLookup");
