-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "senhaHash" TEXT,
ADD COLUMN     "passwordResetToken" TEXT,
ADD COLUMN     "passwordResetExpires" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "super_admins" ADD COLUMN     "passwordResetToken" TEXT,
ADD COLUMN     "passwordResetExpires" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "usuarios_passwordResetToken_idx" ON "usuarios"("passwordResetToken");

-- CreateIndex
CREATE INDEX "super_admins_passwordResetToken_idx" ON "super_admins"("passwordResetToken");
