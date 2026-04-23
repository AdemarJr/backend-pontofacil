-- Adiciona assinatura padrão no usuário (reuso por competência)

ALTER TABLE "usuarios"
  ADD COLUMN IF NOT EXISTS "assinaturaPadraoDataUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "assinaturaPadraoStrokes" JSONB,
  ADD COLUMN IF NOT EXISTS "assinaturaPadraoAtualizadaEm" TIMESTAMP(3);

