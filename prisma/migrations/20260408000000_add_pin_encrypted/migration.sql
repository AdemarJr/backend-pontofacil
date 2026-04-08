-- Add reversible (encrypted) PIN storage for admin viewing
ALTER TABLE "usuarios" ADD COLUMN "pinEncrypted" TEXT;

