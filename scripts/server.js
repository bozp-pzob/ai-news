#!/usr/bin/env node

// Minimal webhook server for AI News collection
// Zero external dependencies. Triggers collection scripts via HMAC-signed requests.

import http from "http";
import crypto from "crypto";
import { execFile } from "child_process";

const PORT = process.env.PORT || 3000;
const SECRET = process.env.COLLECT_WEBHOOK_SECRET;
const ALLOWED = new Set(["all", "elizaos.json", "hyperfy-discord.json"]);

if (!SECRET) {
  console.error("Error: COLLECT_WEBHOOK_SECRET environment variable required");
  console.error("Generate one with: openssl rand -hex 32");
  process.exit(1);
}

// Timing-safe string comparison
function timingSafeEquals(a, b) {
  const bufA = Buffer.from(a || "");
  const bufB = Buffer.from(b || "");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Verify HMAC signature
function verifySignature(body, signature) {
  if (!SECRET || !signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  return timingSafeEquals(expected, signature.trim());
}

// Validate date parameter to prevent command injection
function isValidDate(date) {
  if (!date) return true; // Empty date is allowed
  // Only allow YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) return false;
  
  // Verify it's a real date
  try {
    const parsed = new Date(date + "T00:00:00Z");
    return !isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
  } catch {
    return false;
  }
}

// Run collection script
function runCollection(config, date) {
  return new Promise((resolve) => {
    const dateArg = date ? ` "${date}"` : "";
    const cmd = `flock -n .collect.lock ./scripts/collect-daily.sh "${config}"${dateArg}`;
    
    execFile("/bin/bash", ["-c", cmd], { timeout: 15 * 60_000 }, (err) => {
      if (err?.code === 1) {
        resolve({ success: false, blocked: true });
      } else {
        resolve({ success: !err });
      }
    });
  });
}

// HTTP server
const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  
  // Only accept POST to /run-collect
  if (req.method !== "POST" || req.url !== "/run-collect") {
    res.writeHead(404, {"content-type": "application/json"});
    res.end(JSON.stringify({error: "not_found"}));
    return;
  }

  // Read body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  
  // Verify signature
  if (!verifySignature(body, req.headers["x-hub-signature-256"])) {
    res.writeHead(401, {"content-type": "application/json"});
    res.end(JSON.stringify({error: "invalid_signature"}));
    return;
  }

  // Parse request
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    res.writeHead(400, {"content-type": "application/json"});
    res.end(JSON.stringify({error: "invalid_json"}));
    return;
  }

  const config = String(data?.config || "all");
  const date = String(data?.date || "");
  
  if (!ALLOWED.has(config)) {
    res.writeHead(400, {"content-type": "application/json"});
    res.end(JSON.stringify({error: "bad_config"}));
    return;
  }

  if (!isValidDate(date)) {
    res.writeHead(400, {"content-type": "application/json"});
    res.end(JSON.stringify({error: "invalid_date"}));
    return;
  }

  // Run collection
  if (config === "all") {
    const [result1, result2] = await Promise.all([
      runCollection("elizaos.json", date),
      runCollection("hyperfy-discord.json", date)
    ]);
    const success = result1.success && result2.success;
    const blocked = result1.blocked || result2.blocked;
    
    res.writeHead(success ? 202 : (blocked ? 409 : 500), {"content-type": "application/json"});
    res.end(JSON.stringify({status: success ? "started" : (blocked ? "blocked" : "error")}));
  } else {
    const result = await runCollection(config, date);
    const code = result.success ? 202 : (result.blocked ? 409 : 500);
    const status = result.success ? "started" : (result.blocked ? "blocked" : "error");
    
    res.writeHead(code, {"content-type": "application/json"});
    res.end(JSON.stringify({status}));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Webhook server listening on 127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));