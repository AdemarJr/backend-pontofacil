-- AlterTable
ALTER TABLE "escalas" ADD COLUMN     "horaRetornoAlmoco" TEXT,
ADD COLUMN     "horaSaidaAlmoco" TEXT;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "localRegistroId" TEXT;

-- CreateTable
CREATE TABLE "locais_registro" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "raioMetros" INTEGER NOT NULL DEFAULT 200,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locais_registro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locais_registro_tenantId_idx" ON "locais_registro"("tenantId");

-- AddForeignKey
ALTER TABLE "locais_registro" ADD CONSTRAINT "locais_registro_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_localRegistroId_fkey" FOREIGN KEY ("localRegistroId") REFERENCES "locais_registro"("id") ON DELETE SET NULL ON UPDATE CASCADE;
