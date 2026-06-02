-- Colaborador remoto / isento de cerca virtual (home office móvel).
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "isentoGeofence" BOOLEAN NOT NULL DEFAULT false;
