/**
 * Preenche pinLookup a partir de pinEncrypted (usuários legados).
 * Uso: node src/scripts/backfill-pin-lookup.js
 * Requer PIN_ENCRYPTION_KEY e DATABASE_URL.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { decryptPin, computePinLookup } = require('../utils/pinCrypto');

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.usuario.findMany({
    where: { pinLookup: null, pinEncrypted: { not: null } },
    select: { id: true, tenantId: true, pinEncrypted: true, email: true },
  });

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const u of rows) {
    try {
      const pin = decryptPin(u.pinEncrypted);
      const lookup = computePinLookup(u.tenantId, pin);
      if (!lookup) {
        skip += 1;
        continue;
      }
      const clash = await prisma.usuario.findFirst({
        where: { tenantId: u.tenantId, pinLookup: lookup, id: { not: u.id } },
        select: { id: true },
      });
      if (clash) {
        console.warn(`[skip duplicate] ${u.email} tenant=${u.tenantId}`);
        skip += 1;
        continue;
      }
      await prisma.usuario.update({ where: { id: u.id }, data: { pinLookup: lookup } });
      ok += 1;
    } catch (e) {
      fail += 1;
      console.warn(`[fail] ${u.email}: ${e.message}`);
    }
  }

  console.log(JSON.stringify({ total: rows.length, ok, skip, fail }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
