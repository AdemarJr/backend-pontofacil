// prisma/seed.js
// Popula o banco com dados iniciais para desenvolvimento

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Super Admin — login: email + senha (POST /auth/login)
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@pontofacil.com.br';
  const superAdminSenha = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123456';
  const senhaHashSuper = await bcrypt.hash(superAdminSenha, 12);
  const superAdmin = await prisma.superAdmin.upsert({
    where: { email: superAdminEmail },
    update: { senhaHash: senhaHashSuper },
    create: {
      email: superAdminEmail,
      senhaHash: senhaHashSuper,
      nome: 'Super Administrador',
    },
  });
  console.log('✅ Super Admin:', superAdmin.email);

  // Tenant de demonstração
  const tenant = await prisma.tenant.upsert({
    where: { cnpj: '00.000.000/0001-00' },
    update: {},
    create: {
      razaoSocial: 'Empresa Demonstração Ltda',
      nomeFantasia: 'Demo Corp',
      cnpj: '00.000.000/0001-00',
      email: 'contato@democorp.com.br',
      plano: 'PROFISSIONAL',
      geofenceLat: -23.5505,
      geofenceLng: -46.6333,
      geofenceRaio: 300,
      geofenceAtivo: false,
    },
  });
  console.log('✅ Tenant demo criado:', tenant.nomeFantasia);

  // Gerente (ADMIN) — mesma senha no login por email (campo pinHash no banco)
  const gerenteEmail = 'gerente@democorp.com.br';
  const gerenteSenha = 'Admin@123456';
  const pinHashGerente = await bcrypt.hash(gerenteSenha, 12);
  const admin = await prisma.usuario.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: gerenteEmail } },
    update: { pinHash: pinHashGerente },
    create: {
      tenantId: tenant.id,
      nome: 'João Gerente',
      email: gerenteEmail,
      pinHash: pinHashGerente,
      cargo: 'Gerente',
      role: 'ADMIN',
    },
  });
  console.log('✅ Gerente (ADMIN):', admin.email);

  // Colaboradores de demonstração
  const colaboradores = [
    { nome: 'Maria Silva', email: 'maria@democorp.com.br', pin: '1001', cargo: 'Vendedora' },
    { nome: 'Carlos Santos', email: 'carlos@democorp.com.br', pin: '1002', cargo: 'Analista' },
    { nome: 'Ana Oliveira', email: 'ana@democorp.com.br', pin: '1003', cargo: 'Recepcionista' },
  ];

  for (const colab of colaboradores) {
    const hash = await bcrypt.hash(colab.pin, 12);
    const usuario = await prisma.usuario.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: colab.email } },
      update: {},
      create: {
        tenantId: tenant.id,
        nome: colab.nome,
        email: colab.email,
        pinHash: hash,
        cargo: colab.cargo,
        role: 'COLABORADOR',
      },
    });

    // Escala padrão para cada colaborador
    await prisma.escala.create({
      data: {
        tenantId: tenant.id,
        usuarioId: usuario.id,
        nome: 'Horário Comercial',
        horaInicio: '08:00',
        horaFim: '17:00',
        diasSemana: [1, 2, 3, 4, 5],
        cargaHorariaDiaria: 8,
        intervaloMinutos: 60,
      },
    });
    console.log(`✅ Colaborador: ${colab.nome} | PIN: ${colab.pin}`);
  }

  console.log('\n🎉 Seed concluído!');
  console.log('─────────────────────────────────────────');
  console.log('Super Admin:', superAdminEmail, '|', superAdminSenha);
  console.log('Gerente:    ', gerenteEmail, '|', gerenteSenha);
  console.log('Colaboradores (totem): PIN 1001, 1002, 1003');
  console.log('─────────────────────────────────────────');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
