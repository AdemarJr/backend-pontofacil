FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .
RUN npx prisma generate

EXPOSE 3001

# migrate deploy no start: o build não tem acesso ao banco
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
