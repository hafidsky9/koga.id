# Tahap build memakai kompiler hanya bila paket native (bcrypt, better-sqlite3) tidak punya prebuilt untuk arm64.
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=192
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js db.js ./
COPY lib ./lib
COPY routes ./routes
COPY public ./public
COPY --from=build /app/public/vendor/ ./public/vendor/
RUN mkdir -p data uploads && chown -R node:node data uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
