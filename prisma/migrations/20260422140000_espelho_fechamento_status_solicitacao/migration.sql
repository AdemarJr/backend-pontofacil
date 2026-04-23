-- CreateEnum
CREATE TYPE "StatusEspelhoFechamento" AS ENUM ('AGUARDANDO_ASSINATURA', 'ASSINADO');

-- AlterTable
ALTER TABLE "espelho_fechamentos" ADD COLUMN "status" "StatusEspelhoFechamento" NOT NULL DEFAULT 'ASSINADO';
ALTER TABLE "espelho_fechamentos" ADD COLUMN "solicitadoPorId" TEXT;
ALTER TABLE "espelho_fechamentos" ADD COLUMN "solicitadoEm" TIMESTAMPTZ;

-- Permite registro "só solicitação" antes da assinatura
ALTER TABLE "espelho_fechamentos" ALTER COLUMN "espelhoHash" DROP NOT NULL;
ALTER TABLE "espelho_fechamentos" ALTER COLUMN "aprovadoEm" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "espelho_fechamentos"
ADD CONSTRAINT "espelho_fechamentos_solicitadoPorId_fkey"
FOREIGN KEY ("solicitadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "espelho_fechamentos_tenantId_status_idx" ON "espelho_fechamentos" ("tenantId", "status");
