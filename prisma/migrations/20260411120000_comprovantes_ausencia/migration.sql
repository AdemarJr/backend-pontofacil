-- CreateEnum
CREATE TYPE "StatusComprovante" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO');

-- CreateTable
CREATE TABLE "comprovantes_ausencia" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "dataReferencia" TEXT NOT NULL,
    "dataFim" TEXT,
    "descricao" TEXT,
    "tipoArquivo" TEXT NOT NULL,
    "arquivoKey" TEXT,
    "arquivoUrl" TEXT,
    "mimeType" TEXT,
    "nomeArquivoOriginal" TEXT,
    "status" "StatusComprovante" NOT NULL DEFAULT 'PENDENTE',
    "observacaoAdmin" TEXT,
    "respondidoPorId" TEXT,
    "respondidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comprovantes_ausencia_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "comprovantes_ausencia" ADD CONSTRAINT "comprovantes_ausencia_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprovantes_ausencia" ADD CONSTRAINT "comprovantes_ausencia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprovantes_ausencia" ADD CONSTRAINT "comprovantes_ausencia_respondidoPorId_fkey" FOREIGN KEY ("respondidoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "comprovantes_ausencia_tenantId_status_idx" ON "comprovantes_ausencia"("tenantId", "status");

-- CreateIndex
CREATE INDEX "comprovantes_ausencia_usuarioId_idx" ON "comprovantes_ausencia"("usuarioId");
