-- =============================================================================
-- PontoFácil — Atualização sobre o schema ATUAL de produção
-- =============================================================================
-- Seu banco hoje TEM: tenants, usuarios, registros_ponto, escalas, ferias, etc.
-- Seu banco hoje NÃO TEM (este script adiciona):
--   • Colunas em tenants: contractStartDate, contractEndDate, periodoContrato
--   • Colunas em usuarios: cpf, pis, salarioBase, tipoContrato, dados bancários...
--   • Tabelas: tenant_features, folha_config, folha_runs, holerites
--   • Enums: TipoContrato, TipoContaBancaria, ModoBancoHoras, StatusFolhaRun,
--            PeriodoContratoTenant
--
-- SEGURO: só adiciona. Não apaga nem altera dados existentes.
-- Clientes atuais ficam com periodoContrato NULL → sem expiração automática.
--
-- Como executar (Supabase SQL Editor):
--   1. Rode a PARTE 1 inteira
--   2. Rode a PARTE 2 (registro Prisma)
--   3. Reinicie o backend
-- =============================================================================


-- #############################################################################
-- PARTE 1 — Schema (pode rodar mais de uma vez; ignora o que já existe)
-- #############################################################################

-- Enums
DO $$ BEGIN
  CREATE TYPE "TipoContrato" AS ENUM ('CLT', 'ESTAGIO', 'PJ');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TipoContaBancaria" AS ENUM ('CORRENTE', 'POUPANCA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ModoBancoHoras" AS ENUM ('COMPENSAR', 'PAGAR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StatusFolhaRun" AS ENUM ('RASCUNHO', 'CALCULADA', 'FECHADA', 'PAGA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodoContratoTenant" AS ENUM ('MENSAL', 'SEMESTRAL', 'ANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS "contractStartDate" timestamp without time zone;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS "contractEndDate" timestamp without time zone;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS "periodoContrato" "PeriodoContratoTenant";

-- usuarios (DEFAULT preenche registros existentes automaticamente)
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "cpf" text;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "pis" text;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "matricula" text;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "tipoContrato" "TipoContrato" NOT NULL DEFAULT 'CLT';

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "salarioBase" numeric(12,2);

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "categoriaProfissional" text;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "dependentesIrrf" integer NOT NULL DEFAULT 0;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "contaBanco" text;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "contaAgencia" text;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "contaNumero" text;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS "contaTipo" "TipoContaBancaria";

-- tenant_features
CREATE TABLE IF NOT EXISTS public.tenant_features (
  "tenantId" text NOT NULL,
  "payrollModuleEnabled" boolean NOT NULL DEFAULT false,
  "updatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_features_pkey PRIMARY KEY ("tenantId")
);

-- folha_config
CREATE TABLE IF NOT EXISTS public.folha_config (
  "tenantId" text NOT NULL,
  "modoBancoHoras" "ModoBancoHoras" NOT NULL DEFAULT 'COMPENSAR',
  "heDiaUtilPercent" integer NOT NULL DEFAULT 50,
  "heDomingoFeriadoPercent" integer NOT NULL DEFAULT 100,
  "adicionalNoturnoPercent" integer NOT NULL DEFAULT 20,
  "toleranciaAtrasoMin" integer,
  "pagarDSR" boolean NOT NULL DEFAULT true,
  "permitirFolhaSemAssinatura" boolean NOT NULL DEFAULT false,
  "tabelasVersao" text,
  "tabelasSnapshot" jsonb,
  "bancoCodigo" text,
  "bancoAgencia" text,
  "bancoConta" text,
  "bancoConvenio" text,
  "createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT folha_config_pkey PRIMARY KEY ("tenantId")
);

-- folha_runs
CREATE TABLE IF NOT EXISTS public.folha_runs (
  id text NOT NULL,
  "tenantId" text NOT NULL,
  mes integer NOT NULL,
  ano integer NOT NULL,
  status "StatusFolhaRun" NOT NULL DEFAULT 'RASCUNHO',
  "calculadaEm" timestamp without time zone,
  "fechadaEm" timestamp without time zone,
  "fechadaPorId" text,
  "bloqueadaPorPendencias" jsonb,
  "createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT folha_runs_pkey PRIMARY KEY (id)
);

-- holerites
CREATE TABLE IF NOT EXISTS public.holerites (
  id text NOT NULL,
  "folhaRunId" text NOT NULL,
  "usuarioId" text NOT NULL,
  proventos jsonb NOT NULL,
  descontos jsonb NOT NULL,
  bases jsonb NOT NULL,
  liquido numeric(12,2) NOT NULL,
  "pdfKey" text,
  "createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT holerites_pkey PRIMARY KEY (id)
);

-- Índices
CREATE UNIQUE INDEX IF NOT EXISTS folha_runs_tenantId_mes_ano_key
  ON public.folha_runs ("tenantId", mes, ano);

CREATE INDEX IF NOT EXISTS folha_runs_tenantId_mes_ano_idx
  ON public.folha_runs ("tenantId", mes, ano);

CREATE UNIQUE INDEX IF NOT EXISTS holerites_folhaRunId_usuarioId_key
  ON public.holerites ("folhaRunId", "usuarioId");

CREATE INDEX IF NOT EXISTS holerites_folhaRunId_idx
  ON public.holerites ("folhaRunId");

CREATE INDEX IF NOT EXISTS holerites_usuarioId_idx
  ON public.holerites ("usuarioId");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE public.tenant_features
    ADD CONSTRAINT tenant_features_tenantId_fkey
    FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.folha_config
    ADD CONSTRAINT folha_config_tenantId_fkey
    FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.folha_runs
    ADD CONSTRAINT folha_runs_tenantId_fkey
    FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.folha_runs
    ADD CONSTRAINT folha_runs_fechadaPorId_fkey
    FOREIGN KEY ("fechadaPorId") REFERENCES public.usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.holerites
    ADD CONSTRAINT holerites_folhaRunId_fkey
    FOREIGN KEY ("folhaRunId") REFERENCES public.folha_runs(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.holerites
    ADD CONSTRAINT holerites_usuarioId_fkey
    FOREIGN KEY ("usuarioId") REFERENCES public.usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- #############################################################################
-- PARTE 2 — Registrar no Prisma (rode DEPOIS da Parte 1)
-- id = UUID com exatamente 36 caracteres
-- #############################################################################

INSERT INTO public._prisma_migrations (
  id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
)
SELECT
  'a0660612-0000-4000-8000-000000000001',
  'manual',
  NOW(),
  '20260606120000_folha_pagamento',
  NULL,
  NULL,
  NOW(),
  1
WHERE NOT EXISTS (
  SELECT 1 FROM public._prisma_migrations
  WHERE migration_name = '20260606120000_folha_pagamento'
);

INSERT INTO public._prisma_migrations (
  id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
)
SELECT
  'a0660613-0000-4000-8000-000000000001',
  'manual',
  NOW(),
  '20260606130000_tenant_periodo_contrato',
  NULL,
  NULL,
  NOW(),
  1
WHERE NOT EXISTS (
  SELECT 1 FROM public._prisma_migrations
  WHERE migration_name = '20260606130000_tenant_periodo_contrato'
);


-- #############################################################################
-- PARTE 3 — Conferência (opcional)
-- #############################################################################
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'tenants'
--   AND column_name IN ('periodoContrato', 'contractStartDate', 'contractEndDate');
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('tenant_features', 'folha_config', 'folha_runs', 'holerites');
