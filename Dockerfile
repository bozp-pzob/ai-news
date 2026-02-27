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
# Uses node:20-slim (Debian) instead of Alpine because Patchright/Chromium
# requires glibc and system libraries not available on Alpine.
# =============================================================================
FROM node:20-slim AS backend
WORKDIR /app

# Install Chromium system dependencies required by Patchright
# NOTE: Comprehensive font and system library installation is critical for
# bot detection bypass. Kasada and similar systems fingerprint:
#   - Available fonts (font enumeration)
#   - Canvas/WebGL rendering output (GPU/software renderer differences)
#   - Locale, timezone, and other system properties
# A minimal Docker environment with few fonts is trivially detectable.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    # --- Chrome core dependencies ---
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    xvfb \
    # --- Fonts: critical for font fingerprinting bypass ---
    # Without realistic fonts, Kasada detects the server environment instantly.
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    fonts-dejavu-core \
    fonts-dejavu-extra \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    fontconfig \
    # --- Locale/timezone support ---
    locales \
    tzdata \
    # --- dbus session bus (some Chrome features need it) ---
    dbus \
    && rm -rf /var/lib/apt/lists/*

# Set up locale (Kasada checks Accept-Language / navigator.language consistency)
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

# Set timezone (Kasada checks Date().getTimezoneOffset() consistency)
ENV TZ=America/New_York
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Build font cache so Chrome can enumerate fonts properly
RUN fc-cache -fv

# Create non-root user for Chrome (Chrome has sandbox issues when running as
# root, requiring --no-sandbox which is a detectable automation fingerprint.
# Running as a regular user avoids this entirely.)
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video -d /home/appuser -s /sbin/nologin appuser \
    && mkdir -p /home/appuser && chown -R appuser:appuser /home/appuser

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Install Patchright Chrome browser
RUN npx patchright install chrome

# Copy built backend from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory for runtime files and ensure non-root user can write.
# Also grant access to node_modules (for patchright browser binary) and dist/.
RUN mkdir -p /app/data /app/.browser-data \
    && chown -R appuser:appuser /app/data /app/.browser-data /app/dist \
    && chmod -R o+rx /app/node_modules

# Ensure patchright's browser cache is accessible by appuser.
# Patchright stores browsers in ~/.cache/ms-playwright/ or node_modules path.
RUN if [ -d /root/.cache/ms-playwright ]; then \
      mkdir -p /home/appuser/.cache && \
      cp -r /root/.cache/ms-playwright /home/appuser/.cache/ && \
      chown -R appuser:appuser /home/appuser/.cache; \
    fi

# Switch to non-root user
USER appuser

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
