-- Férias em R$, 13º salário e rescisão

CREATE TYPE "TipoRescisao" AS ENUM ('SEM_JUSTA_CAUSA', 'PEDIDO_DEMISSAO', 'ACORDO', 'JUSTA_CAUSA');

CREATE TABLE IF NOT EXISTS "ferias_pagamentos" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "feriasId" TEXT,
  "diasFerias" INTEGER NOT NULL,
  "diasAbono" INTEGER NOT NULL DEFAULT 0,
  "adiantamentoUmTerco" BOOLEAN NOT NULL DEFAULT true,
  "dataInicio" TEXT NOT NULL,
  "dataFim" TEXT NOT NULL,
  "mesReferencia" INTEGER NOT NULL,
  "anoReferencia" INTEGER NOT NULL,
  "proventos" JSONB NOT NULL,
  "descontos" JSONB NOT NULL,
  "bases" JSONB NOT NULL,
  "liquido" DECIMAL(12,2) NOT NULL,
  "status" "StatusFolhaRun" NOT NULL DEFAULT 'CALCULADA',
  "calculadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ferias_pagamentos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ferias_pagamentos_feriasId_key" ON "ferias_pagamentos"("feriasId");
CREATE INDEX IF NOT EXISTS "ferias_pagamentos_tenantId_usuarioId_idx" ON "ferias_pagamentos"("tenantId", "usuarioId");

CREATE TABLE IF NOT EXISTS "decimo_terceiro_runs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ano" INTEGER NOT NULL,
  "parcela" INTEGER NOT NULL,
  "status" "StatusFolhaRun" NOT NULL DEFAULT 'CALCULADA',
  "calculadaEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "decimo_terceiro_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "decimo_terceiro_runs_tenantId_ano_parcela_key"
  ON "decimo_terceiro_runs"("tenantId", "ano", "parcela");

CREATE TABLE IF NOT EXISTS "decimo_terceiro_holerites" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "mesesTrabalhados" INTEGER NOT NULL,
  "proventos" JSONB NOT NULL,
  "descontos" JSONB NOT NULL,
  "bases" JSONB NOT NULL,
  "liquido" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "decimo_terceiro_holerites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "decimo_terceiro_holerites_runId_usuarioId_key"
  ON "decimo_terceiro_holerites"("runId", "usuarioId");

CREATE TABLE IF NOT EXISTS "rescisoes" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "tipo" "TipoRescisao" NOT NULL,
  "dataDesligamento" TIMESTAMP(3) NOT NULL,
  "avisoPrevioIndenizado" BOOLEAN NOT NULL DEFAULT false,
  "diasAvisoPrevio" INTEGER NOT NULL DEFAULT 0,
  "proventos" JSONB NOT NULL,
  "descontos" JSONB NOT NULL,
  "bases" JSONB NOT NULL,
  "liquido" DECIMAL(12,2) NOT NULL,
  "multaFgtsEstimada" DECIMAL(12,2),
  "observacoes" TEXT,
  "status" "StatusFolhaRun" NOT NULL DEFAULT 'CALCULADA',
  "calculadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rescisoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rescisoes_tenantId_usuarioId_idx" ON "rescisoes"("tenantId", "usuarioId");

ALTER TABLE "ferias_pagamentos" ADD CONSTRAINT "ferias_pagamentos_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ferias_pagamentos" ADD CONSTRAINT "ferias_pagamentos_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ferias_pagamentos" ADD CONSTRAINT "ferias_pagamentos_feriasId_fkey"
  FOREIGN KEY ("feriasId") REFERENCES "ferias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "decimo_terceiro_runs" ADD CONSTRAINT "decimo_terceiro_runs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "decimo_terceiro_holerites" ADD CONSTRAINT "decimo_terceiro_holerites_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "decimo_terceiro_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decimo_terceiro_holerites" ADD CONSTRAINT "decimo_terceiro_holerites_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rescisoes" ADD CONSTRAINT "rescisoes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rescisoes" ADD CONSTRAINT "rescisoes_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
