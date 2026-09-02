# Multi-stage production build for AWS App Runner, ECS, or EC2
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first for efficient layer caching
COPY package*.json ./
RUN npm ci || npm install

# Copy source code and build
COPY . .
RUN npm run build

# Production runtime image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install curl for healthchecks
RUN apk add --no-cache curl

# Copy production dependencies and build artifacts
COPY package*.json ./
RUN (npm ci --omit=dev || npm install --omit=dev) && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/index.html ./index.html

# Expose container port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health/ping || exit 1

# Start bundled CommonJS server
CMD ["node", "dist/server.cjs"]
