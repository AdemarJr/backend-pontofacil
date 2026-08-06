-- =============================================================================
-- Baseline Prisma + schema folha recente (homolog / EasyPanel)
-- =============================================================================
-- Problema: banco criado/atualizado manualmente SEM tabela _prisma_migrations.
-- O Railway roda migrate deploy no build e falha ao tentar CREATE TABLE duplicado,
-- ou o backend fica com Prisma desalinhado do banco.
--
-- Este script:
--   1. Cria _prisma_migrations (se não existir)
--   2. Marca TODAS as migrations do repo como já aplicadas
--   3. Aplica colunas/tabelas novas (benefícios, férias R$, 13º, rescisão)
--
-- SEGURO: só ADD / CREATE IF NOT EXISTS. Não apaga dados.
-- Rode no SQL Editor do Postgres (EasyPanel) do banco pontos-pyrou.
-- Depois: redeploy do backend no Railway.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public._prisma_migrations (
  id VARCHAR(36) PRIMARY KEY NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  finished_at TIMESTAMPTZ,
  migration_name VARCHAR(255) NOT NULL,
  logs TEXT,
  rolled_back_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_steps_count INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS _prisma_migrations_migration_name_key
  ON public._prisma_migrations (migration_name);

-- Registrar migrations (baseline manual — checksum 'manual' ok para deploy futuro)
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT * FROM (VALUES
  ('b0000001-0000-4000-8000-000000000001', 'manual', NOW(), '20260209120000_senha_web_reset_email', NOW(), 1),
  ('b0000002-0000-4000-8000-000000000001', 'manual', NOW(), '20260407192136_pontofacil', NOW(), 1),
  ('b0000003-0000-4000-8000-000000000001', 'manual', NOW(), '20260408000000_add_pin_encrypted', NOW(), 1),
  ('b0000004-0000-4000-8000-000000000001', 'manual', NOW(), '20260408223443_locais_escala_horarios', NOW(), 1),
  ('b0000005-0000-4000-8000-000000000001', 'manual', NOW(), '20260411120000_comprovantes_ausencia', NOW(), 1),
  ('b0000006-0000-4000-8000-000000000001', 'manual', NOW(), '20260414120000_tenant_minimos_ponto', NOW(), 1),
  ('b0000007-0000-4000-8000-000000000001', 'manual', NOW(), '20260414153000_solicitacoes_ajuste_ponto', NOW(), 1),
  ('b0000008-0000-4000-8000-000000000001', 'manual', NOW(), '20260414160000_registro_ponto_soft_delete', NOW(), 1),
  ('b0000009-0000-4000-8000-000000000001', 'manual', NOW(), '20260416120000_canais_registro', NOW(), 1),
  ('b0000010-0000-4000-8000-000000000001', 'manual', NOW(), '20260421130000_espelho_fechamento', NOW(), 1),
  ('b0000011-0000-4000-8000-000000000001', 'manual', NOW(), '20260422140000_espelho_fechamento_status_solicitacao', NOW(), 1),
  ('b0000012-0000-4000-8000-000000000001', 'manual', NOW(), '20260423120000_usuario_assinatura_padrao', NOW(), 1),
  ('b0000013-0000-4000-8000-000000000001', 'manual', NOW(), '20260512120000_registro_client_request_id', NOW(), 1),
  ('b0000014-0000-4000-8000-000000000001', 'manual', NOW(), '20260602180000_usuario_isento_geofence', NOW(), 1),
  ('b0000015-0000-4000-8000-000000000001', 'manual', NOW(), '20260606120000_folha_pagamento', NOW(), 1),
  ('b0000016-0000-4000-8000-000000000001', 'manual', NOW(), '20260606130000_tenant_periodo_contrato', NOW(), 1),
  ('b0000017-0000-4000-8000-000000000001', 'manual', NOW(), '20260723120000_rep_p_conformidade', NOW(), 1),
  ('b0000018-0000-4000-8000-000000000001', 'manual', NOW(), '20260725120000_planos_comerciais_infinitipay', NOW(), 1),
  ('b0000019-0000-4000-8000-000000000001', 'manual', NOW(), '20260725130000_integracao_infinitipay_config', NOW(), 1),
  ('b0000020-0000-4000-8000-000000000001', 'manual', NOW(), '20260728120000_folha_beneficios', NOW(), 1),
  ('b0000021-0000-4000-8000-000000000001', 'manual', NOW(), '20260728140000_folha_ferias_decimo_rescisao', NOW(), 1)
) AS v(id, checksum, finished_at, migration_name, started_at, applied_steps_count)
WHERE NOT EXISTS (
  SELECT 1 FROM public._prisma_migrations m WHERE m.migration_name = v.migration_name
);

-- Benefícios folha (20260728120000)
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS "usaVt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS "valorVtMensal" DECIMAL(12,2);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS "descontoVaMensal" DECIMAL(12,2);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS "descontoPlanoSaudeMensal" DECIMAL(12,2);

ALTER TABLE public.folha_config ADD COLUMN IF NOT EXISTS "vtPercentMax" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE public.folha_config ADD COLUMN IF NOT EXISTS "vtProporcionalFaltas" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.folha_config ADD COLUMN IF NOT EXISTS "descontarAtrasos" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.folha_config ADD COLUMN IF NOT EXISTS "descontoAtrasoDiarioPercent" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE public.folha_config ADD COLUMN IF NOT EXISTS "descontarIntervaloInsuficiente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.folha_config ADD COLUMN IF NOT EXISTS "descontoIntervaloDiarioPercent" INTEGER NOT NULL DEFAULT 25;

-- Férias R$, 13º, rescisão (20260728140000)
DO $$ BEGIN
  CREATE TYPE "TipoRescisao" AS ENUM ('SEM_JUSTA_CAUSA', 'PEDIDO_DEMISSAO', 'ACORDO', 'JUSTA_CAUSA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.ferias_pagamentos (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  "usuarioId" TEXT NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  "feriasId" TEXT UNIQUE REFERENCES public.ferias(id) ON DELETE SET NULL,
  "diasFerias" INTEGER NOT NULL,
  "diasAbono" INTEGER NOT NULL DEFAULT 0,
  "adiantamentoUmTerco" BOOLEAN NOT NULL DEFAULT true,
  "dataInicio" TEXT NOT NULL,
  "dataFim" TEXT NOT NULL,
  "mesReferencia" INTEGER NOT NULL,
  "anoReferencia" INTEGER NOT NULL,
  proventos JSONB NOT NULL,
  descontos JSONB NOT NULL,
  bases JSONB NOT NULL,
  liquido DECIMAL(12,2) NOT NULL,
  status "StatusFolhaRun" NOT NULL DEFAULT 'CALCULADA',
  "calculadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ferias_pagamentos_tenant_usuario_idx ON public.ferias_pagamentos ("tenantId", "usuarioId");

CREATE TABLE IF NOT EXISTS public.decimo_terceiro_runs (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  parcela INTEGER NOT NULL,
  status "StatusFolhaRun" NOT NULL DEFAULT 'CALCULADA',
  "calculadaEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", ano, parcela)
);

CREATE TABLE IF NOT EXISTS public.decimo_terceiro_holerites (
  id TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL REFERENCES public.decimo_terceiro_runs(id) ON DELETE CASCADE,
  "usuarioId" TEXT NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  "mesesTrabalhados" INTEGER NOT NULL,
  proventos JSONB NOT NULL,
  descontos JSONB NOT NULL,
  bases JSONB NOT NULL,
  liquido DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("runId", "usuarioId")
);

CREATE TABLE IF NOT EXISTS public.rescisoes (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  "usuarioId" TEXT NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  tipo "TipoRescisao" NOT NULL,
  "dataDesligamento" TIMESTAMP(3) NOT NULL,
  "avisoPrevioIndenizado" BOOLEAN NOT NULL DEFAULT false,
  "diasAvisoPrevio" INTEGER NOT NULL DEFAULT 0,
  proventos JSONB NOT NULL,
  descontos JSONB NOT NULL,
  bases JSONB NOT NULL,
  liquido DECIMAL(12,2) NOT NULL,
  "multaFgtsEstimada" DECIMAL(12,2),
  observacoes TEXT,
  status "StatusFolhaRun" NOT NULL DEFAULT 'CALCULADA',
  "calculadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS rescisoes_tenant_usuario_idx ON public.rescisoes ("tenantId", "usuarioId");
