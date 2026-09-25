# Imagem do aspen-worker (ADR 0013). Contexto: raiz do repositório, como sai
# do `git archive`; o que entra está em Dockerfile.dockerignore.
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS base
WORKDIR /app
COPY package.json package-lock.json ./

# Só dependências de produção, num estágio que não depende do código: a camada
# fica em cache e é a mesma em todas as imagens enquanto o lockfile não muda.
FROM base AS deps
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS build
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY scripts/build-api.mjs scripts/
COPY api api
RUN node scripts/build-api.mjs

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/api api
ARG GIT_SHA=dev
ENV ASPEN_WORKER_SHA=${GIT_SHA}
USER node
EXPOSE 8080
# Não toca o banco: o /health só confirma que o processo atende.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "api/_worker/main.js"]
