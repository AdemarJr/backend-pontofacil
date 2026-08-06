FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .
RUN npx prisma generate

EXPOSE 3001

# migrate com timeout; se travar/falhar, sobe o Node mesmo assim (evita 502)
CMD ["sh", "-c", "timeout 45 npx prisma migrate deploy || true; exec node src/server.js"]
