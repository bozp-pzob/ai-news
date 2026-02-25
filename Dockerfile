# =============================================================================
# Digital Gardener - Multi-Target Dockerfile
# =============================================================================
# This Dockerfile supports multiple build targets:
#   - frontend: React app served via nginx
#   - backend:  Express API server
#   - mcp:      Model Context Protocol server
#
# Usage:
#   docker build --target frontend -t digital-gardener-frontend .
#   docker build --target backend -t digital-gardener-backend .
#   docker build --target mcp -t digital-gardener-mcp .
# =============================================================================

# =============================================================================
# Stage: base
# Common Node.js base image
# =============================================================================
FROM node:20-alpine AS base
WORKDIR /app

# =============================================================================
# Stage: builder
# Builds both frontend and backend from source
# =============================================================================
FROM base AS builder

# Build arguments for frontend (baked in at build time)
ARG REACT_APP_API_URL=
ARG REACT_APP_PRIVY_APP_ID=

# Copy package files for dependency installation
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install all dependencies (including devDependencies for build)
RUN npm ci
RUN cd frontend && npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build backend (TypeScript -> dist/)
RUN npm run build

# Build frontend (React -> frontend/build/)
# Pass REACT_APP_* variables to the build process
# CI=false prevents treating warnings as errors
RUN cd frontend && CI=false \
    REACT_APP_API_URL=$REACT_APP_API_URL \
    REACT_APP_PRIVY_APP_ID=$REACT_APP_PRIVY_APP_ID \
    npm run build

# =============================================================================
# Target: backend
# Production backend API server
# =============================================================================
FROM base AS backend

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built backend from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory for runtime files
RUN mkdir -p /app/data

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose API port
EXPOSE 3000

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Start the API server
CMD ["node", "dist/api.js"]

# =============================================================================
# Target: frontend
# Production frontend served via nginx
# =============================================================================
FROM nginx:alpine AS frontend

# Copy built frontend from builder stage
COPY --from=builder /app/frontend/build /usr/share/nginx/html

# Copy nginx configuration for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port
EXPOSE 80

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

# Start nginx in foreground
CMD ["nginx", "-g", "daemon off;"]

# =============================================================================
# Target: mcp
# Model Context Protocol server for AI integrations
# =============================================================================
FROM base AS mcp

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built MCP server from builder stage
COPY --from=builder /app/dist ./dist

# Set production environment
ENV NODE_ENV=production

# MCP server uses stdio transport by default
# It reads from stdin and writes to stdout for MCP protocol communication
CMD ["node", "dist/mcp/server.js"]
