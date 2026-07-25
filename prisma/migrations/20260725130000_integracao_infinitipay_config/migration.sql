-- Configuração InfinitePay editável no Super Admin

CREATE TABLE "integracao_infinitipay" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "handle" TEXT,
    "apiPublicUrl" TEXT,
    "webhookUrl" TEXT,
    "redirectUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByEmail" TEXT,

    CONSTRAINT "integracao_infinitipay_pkey" PRIMARY KEY ("id")
);

INSERT INTO "integracao_infinitipay" ("id", "ativo", "updatedAt")
VALUES ('default', false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
