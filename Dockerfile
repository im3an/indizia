# Self-hosting image: Node server + static app + API (relay, username checks, icons).
FROM node:24.22.0-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY public ./public
RUN npm ci --omit=dev

FROM node:24.22.0-alpine3.24
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build --chown=root:root /app/public ./public
COPY server ./server
COPY package.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/node.mjs"]
