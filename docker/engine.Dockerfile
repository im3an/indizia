# Desktop network engine: the Indizia API only (relay, username checks, fingerprint, icons), no static files.
# The desktop app builds it from its own bundled server/ code, so it never pulls Indizia from a registry.
# No npm install: the API has no runtime dependencies.
FROM node:24.22.0-alpine3.24
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 INDIZIA_API_ONLY=1 INDIZIA_LOCAL=1
COPY server ./server
COPY public/src/hosting.js ./public/src/hosting.js
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/node.mjs"]
