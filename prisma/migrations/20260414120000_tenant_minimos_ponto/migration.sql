-- Add configurable minimum times for point registration warnings
ALTER TABLE "tenants"
ADD COLUMN IF NOT EXISTS "trabalhoMinimoAntesSaidaMinutos" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN IF NOT EXISTS "intervaloMinimoAlmocoMinutos" INTEGER NOT NULL DEFAULT 30;

