#!/usr/bin/env node

/**
 * Secure Webhook Server with HMAC Authentication
 * 
 * This is an enhanced webhook server that migrates from insecure webhook
 * implementations to HMAC-SHA256 authenticated requests.
 * 
 * Security Features:
 * - HMAC-SHA256 signature verification
 * - Timing-safe signature comparison
 * - Input validation and sanitization
 * - Rate limiting and request throttling
 * - Request logging with security events
 * - Process isolation and timeout protection
 */

const http = require("http");
const crypto = require("crypto");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

// Configuration
const PORT = process.env.PORT || 3000;
const SECRET = process.env.COLLECT_WEBHOOK_SECRET;
const ALLOWED_CONFIGS = new Set(["all", "elizaos.json", "hyperfy-discord.json"]);
const MAX_BODY_SIZE = 10 * 1024; // 10KB limit
const REQUEST_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

// Rate limiting storage
const requestCounts = new Map();

// Security validation
if (!SECRET) {
  console.error("❌ Error: COLLECT_WEBHOOK_SECRET environment variable is required");
  console.error("💡 Generate a secure secret with: openssl rand -hex 32");
  console.error("🔒 This secret enables HMAC-SHA256 authentication for webhook security");
  process.exit(1);
}

if (SECRET.length < 32) {
  console.error("⚠️  Warning: COLLECT_WEBHOOK_SECRET should be at least 32 characters long");
  console.error("💡 Generate a stronger secret with: openssl rand -hex 32");
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEquals(a, b) {
  const bufA = Buffer.from(a || "");
  const bufB = Buffer.from(b || "");
  
  if (bufA.length !== bufB.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify HMAC-SHA256 signature using GitHub's format
 */
function verifySignature(payload, signature) {
  if (!SECRET || !signature) {
    return false;
  }
  
  // GitHub sends signature in format: sha256=<hex-digest>
  if (!signature.startsWith('sha256=')) {
    return false;
  }
  
  const receivedSignature = signature.substring(7);
  const expectedSignature = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex");
  
  return timingSafeEquals(expectedSignature, receivedSignature);
}

/**
 * Rate limiting implementation
 */
function isRateLimited(clientIP) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  // Clean old entries
  for (const [ip, requests] of requestCounts) {
    requestCounts.set(ip, requests.filter(time => time > windowStart));
    if (requestCounts.get(ip).length === 0) {
      requestCounts.delete(ip);
    }
  }
  
  // Check current client
  const clientRequests = requestCounts.get(clientIP) || [];
  
  if (clientRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  // Add current request
  clientRequests.push(now);
  requestCounts.set(clientIP, clientRequests);
  
  return false;
}

/**
 * Validate date parameter to prevent command injection
 */
function isValidDate(date) {
  if (!date) return true; // Empty date is allowed
  
  // Only allow YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return false;
  }
  
  // Verify it's a real date
  try {
    const parsed = new Date(date + "T00:00:00Z");
    const isValid = !isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
    
    // Additional check: date should be reasonable (not too far in past/future)
    const now = new Date();
    const maxPast = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000)); // 1 year ago
    const maxFuture = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days future
    
    return isValid && parsed >= maxPast && parsed <= maxFuture;
  } catch {
    return false;
  }
}

/**
 * Log security events
 */
function logSecurityEvent(event, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    ...details
  };
  
  console.log(`🔒 [SECURITY] ${JSON.stringify(logEntry)}`);
}

/**
 * Run collection script with security isolation
 */
function runCollection(config, date, clientIP) {
  return new Promise((resolve) => {
    const dateArg = date ? ` "${date}"` : "";
    const cmd = `flock -n .collect.lock ./scripts/collect-daily.sh "${config}"${dateArg}`;
    
    logSecurityEvent("collection_started", { config, date, clientIP });
    
    execFile("/bin/bash", ["-c", cmd], { 
      timeout: REQUEST_TIMEOUT,
      env: { ...process.env, NODE_ENV: 'production' }
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 1) {
          logSecurityEvent("collection_blocked", { config, date, clientIP, reason: "lock_file" });
          resolve({ success: false, blocked: true, message: "Another collection is in progress" });
        } else if (error.killed && error.signal === 'SIGTERM') {
          logSecurityEvent("collection_timeout", { config, date, clientIP });
          resolve({ success: false, blocked: false, message: "Collection timeout" });
        } else {
          logSecurityEvent("collection_failed", { config, date, clientIP, error: error.message });
          resolve({ success: false, blocked: false, message: "Collection failed" });
        }
      } else {
        logSecurityEvent("collection_completed", { config, date, clientIP });
        resolve({ success: true, blocked: false, message: "Collection started successfully" });
      }
    });
  });
}

/**
 * Enhanced HTTP server with security features
 */
const server = http.createServer(async (req, res) => {
  const clientIP = req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
  const startTime = Date.now();
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  try {
    // Health check endpoint
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        status: "healthy", 
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        security: "hmac-sha256"
      }));
      return;
    }
    
    // Security info endpoint
    if (req.method === "GET" && req.url === "/security") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        authentication: "HMAC-SHA256",
        algorithm: "sha256",
        header: "X-Hub-Signature-256",
        format: "sha256=<hex-digest>",
        rateLimit: `${MAX_REQUESTS_PER_WINDOW} requests per ${RATE_LIMIT_WINDOW/1000} seconds`,
        maxBodySize: `${MAX_BODY_SIZE} bytes`,
        timeout: `${REQUEST_TIMEOUT/1000} seconds`
      }));
      return;
    }
    
    // Only accept POST to /run-collect
    if (req.method !== "POST" || req.url !== "/run-collect") {
      logSecurityEvent("invalid_endpoint", { method: req.method, url: req.url, clientIP });
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "endpoint_not_found", code: "E001" }));
      return;
    }

    // Rate limiting
    if (isRateLimited(clientIP)) {
      logSecurityEvent("rate_limit_exceeded", { clientIP });
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "rate_limit_exceeded", 
        code: "E002",
        retry_after: Math.ceil(RATE_LIMIT_WINDOW / 1000)
      }));
      return;
    }

    // Read and validate body size
    const chunks = [];
    let totalSize = 0;
    
    for await (const chunk of req) {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        logSecurityEvent("payload_too_large", { clientIP, size: totalSize });
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          error: "payload_too_large", 
          code: "E003",
          max_size: MAX_BODY_SIZE
        }));
        return;
      }
      chunks.push(chunk);
    }
    
    const body = Buffer.concat(chunks);
    
    // Verify HMAC signature
    const signature = req.headers["x-hub-signature-256"];
    if (!verifySignature(body, signature)) {
      logSecurityEvent("invalid_signature", { clientIP, signature_present: !!signature });
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "authentication_failed", 
        code: "E004",
        message: "Invalid or missing HMAC signature"
      }));
      return;
    }

    // Parse and validate JSON
    let data;
    try {
      data = JSON.parse(body.toString());
    } catch (parseError) {
      logSecurityEvent("invalid_json", { clientIP, error: parseError.message });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "invalid_json_payload", 
        code: "E005"
      }));
      return;
    }

    // Validate request parameters
    const config = String(data?.config || "").trim();
    const date = String(data?.date || "").trim();
    
    if (!config || !ALLOWED_CONFIGS.has(config)) {
      logSecurityEvent("invalid_config", { clientIP, config });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "invalid_config", 
        code: "E006",
        allowed_configs: Array.from(ALLOWED_CONFIGS)
      }));
      return;
    }

    if (date && !isValidDate(date)) {
      logSecurityEvent("invalid_date", { clientIP, date });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "invalid_date_format", 
        code: "E007",
        expected_format: "YYYY-MM-DD"
      }));
      return;
    }

    // Execute collection
    if (config === "all") {
      const [result1, result2] = await Promise.all([
        runCollection("elizaos.json", date, clientIP),
        runCollection("hyperfy-discord.json", date, clientIP)
      ]);
      
      const allSuccessful = result1.success && result2.success;
      const anyBlocked = result1.blocked || result2.blocked;
      
      const responseCode = allSuccessful ? 202 : (anyBlocked ? 409 : 500);
      const status = allSuccessful ? "started" : (anyBlocked ? "blocked" : "failed");
      
      res.writeHead(responseCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        status,
        results: {
          elizaos: { success: result1.success, message: result1.message },
          hyperfy: { success: result2.success, message: result2.message }
        },
        processing_time_ms: Date.now() - startTime
      }));
    } else {
      const result = await runCollection(config, date, clientIP);
      const responseCode = result.success ? 202 : (result.blocked ? 409 : 500);
      
      res.writeHead(responseCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        status: result.success ? "started" : (result.blocked ? "blocked" : "failed"),
        message: result.message,
        processing_time_ms: Date.now() - startTime
      }));
    }
    
  } catch (error) {
    logSecurityEvent("server_error", { clientIP, error: error.message });
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      error: "internal_server_error", 
      code: "E999"
    }));
  }
});

// Enhanced server startup with security logging
server.listen(PORT, "127.0.0.1", () => {
  console.log(`🚀 Secure Webhook Server v2.0 listening on 127.0.0.1:${PORT}`);
  console.log(`🔒 HMAC-SHA256 authentication enabled`);
  console.log(`⏱️  Rate limit: ${MAX_REQUESTS_PER_WINDOW} requests per ${RATE_LIMIT_WINDOW/1000}s`);
  console.log(`📏 Max payload: ${MAX_BODY_SIZE} bytes`);
  console.log(`⏰ Request timeout: ${REQUEST_TIMEOUT/1000}s`);
  console.log(`💡 Health check: GET http://127.0.0.1:${PORT}/healthz`);
  console.log(`🔍 Security info: GET http://127.0.0.1:${PORT}/security`);
  
  logSecurityEvent("server_started", { 
    port: PORT, 
    version: "2.0.0",
    authentication: "HMAC-SHA256"
  });
});

// Graceful shutdown with cleanup
function gracefulShutdown(signal) {
  logSecurityEvent("server_shutdown", { signal });
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
  
  server.close(() => {
    console.log("✅ HTTP server closed");
    requestCounts.clear();
    process.exit(0);
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error("❌ Force shutdown after timeout");
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));