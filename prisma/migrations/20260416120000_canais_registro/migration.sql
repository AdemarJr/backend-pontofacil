-- Add per-tenant channel toggles (Totem vs Meu Ponto)
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "permitirTotem" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "permitirMeuPonto" BOOLEAN NOT NULL DEFAULT TRUE;

