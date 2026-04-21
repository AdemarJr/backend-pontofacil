-- CreateTable
CREATE TABLE "espelho_fechamentos" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "mes" INTEGER NOT NULL,
  "ano" INTEGER NOT NULL,
  "espelhoHash" TEXT NOT NULL,
  "aprovadoEm" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "assinaturaDataUrl" TEXT,
  "assinaturaStrokes" JSONB,
  "ipHash" TEXT,
  "userAgent" TEXT,
  "deviceId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "espelho_fechamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "espelho_fechamentos_tenantId_usuarioId_mes_ano_key"
ON "espelho_fechamentos" ("tenantId", "usuarioId", "mes", "ano");

-- CreateIndex
CREATE INDEX "espelho_fechamentos_tenantId_mes_ano_idx"
ON "espelho_fechamentos" ("tenantId", "mes", "ano");

-- CreateIndex
CREATE INDEX "espelho_fechamentos_tenantId_usuarioId_idx"
ON "espelho_fechamentos" ("tenantId", "usuarioId");

-- AddForeignKey
ALTER TABLE "espelho_fechamentos"
ADD CONSTRAINT "espelho_fechamentos_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "espelho_fechamentos"
ADD CONSTRAINT "espelho_fechamentos_usuarioId_fkey"
FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

