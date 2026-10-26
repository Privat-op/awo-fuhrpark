FROM node:22.18.0-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev


FROM node:22.18.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    PORT=3000 \
    DATA_DIR=/app/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY public ./public

RUN mkdir -p /app/data/uploads/vehicles /app/data/uploads/receipts /app/data/backups \
  && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
