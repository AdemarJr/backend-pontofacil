-- Meu Ponto offline: idempotência por dispositivo/requisição
ALTER TABLE "registros_ponto" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "registros_ponto_client_request_unique"
  ON "registros_ponto" ("tenantId", "usuarioId", "clientRequestId");
