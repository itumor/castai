# CAST AI MCP server container.
#
# Multi-stage build: install production dependencies in a builder layer,
# then copy only what's needed into the slim runtime image. The stdio
# entry point is src/server.js; logs go to stderr, MCP frames travel on
# stdin/stdout.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    APPROVAL_MODE=block \
    CASTAI_API_BASE=https://api.eu.cast.ai
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# The server is stdio-only; do NOT allocate a TTY when running.
CMD ["node", "src/server.js"]
