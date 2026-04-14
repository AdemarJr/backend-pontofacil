import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error('Missing DIRECT_URL or DATABASE_URL');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url,
  },
});

