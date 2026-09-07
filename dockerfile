FROM node:22-slim AS web
WORKDIR /app/web

COPY web/package*.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src/ ./src/

COPY --from=web /app/web/dist ./web/dist


ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]