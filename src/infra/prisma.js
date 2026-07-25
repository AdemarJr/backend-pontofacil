// Instância única (singleton) do PrismaClient para todo o backend.
// Evita abrir vários pools de conexão (um por controller), que esgotava
// o limite do PostgreSQL e causava timeouts na conexão.
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__pontofacilPrisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

// Em dev, o nodemon recarrega os módulos a cada salvamento; guardar no global
// garante que não nasça uma nova instância (e um novo pool) a cada reload.
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__pontofacilPrisma = prisma;
}

module.exports = prisma;
