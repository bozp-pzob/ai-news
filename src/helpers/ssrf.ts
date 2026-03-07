/**
 * SSRF (Server-Side Request Forgery) protection utilities.
 *
 * Used by the relay and data proxy to validate that target URLs
 * do not point to internal/private networks or cloud metadata services.
 *
 * Set RELAY_ALLOW_PRIVATE=true in env to allow private IPs (development only).
 */

import net from 'net';
import dns from 'dns/promises';

/**
 * Check if an IP address is in a private/reserved range.
 *
 * Blocked ranges:
 * - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918)
 * - 127.0.0.0/8 (loopback)
 * - 169.254.0.0/16 (link-local / cloud metadata)
 * - 0.0.0.0
 * - ::1, ::, fc00::/7, fe80::/10 (IPv6 private/link-local)
 */
export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;                                       // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;  // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;                  // 192.168.0.0/16
    if (parts[0] === 127) return true;                                       // 127.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true;                  // 169.254.0.0/16
    if (parts[0] === 0) return true;                                         // 0.0.0.0/8
    return false;
  }

  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm === '::') return true;                 // loopback / unspecified
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true;  // fc00::/7 unique-local
    if (norm.startsWith('fe80')) return true;                          // fe80::/10 link-local
    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    if (norm.startsWith('::ffff:')) {
      return isPrivateIP(norm.slice(7));
    }
    return false;
  }

  return false;
}

/** Hostnames known to serve cloud instance metadata */
const BLOCKED_HOSTS = [
  'metadata.google.internal',
  'metadata.google.com',
  'metadata.azure.com',
  'instance-data',  // EC2 alias
];

/**
 * Validate that a URL is safe to relay/proxy to.
 *
 * - Blocks non-HTTP(S) schemes
 * - Blocks private IP ranges and cloud metadata endpoints
 * - Resolves DNS to check for rebinding attacks
 * - Set RELAY_ALLOW_PRIVATE=true in env to allow private IPs (development)
 */
export async function isValidRelayTarget(urlStr: string): Promise<boolean> {
  // Development mode: allow private IPs
  if (process.env.RELAY_ALLOW_PRIVATE === 'true') {
    try {
      const url = new URL(urlStr);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const hostname = url.hostname;

    // Direct IP check
    if (net.isIP(hostname)) {
      return !isPrivateIP(hostname);
    }

    // Blocked hostnames
    if (BLOCKED_HOSTS.includes(hostname.toLowerCase())) return false;

    // DNS resolution check (prevents DNS rebinding)
    try {
      const addrs = await dns.resolve4(hostname);
      if (addrs.some(isPrivateIP)) return false;
    } catch { /* no A records — ok */ }

    try {
      const addrs = await dns.resolve6(hostname);
      if (addrs.some(isPrivateIP)) return false;
    } catch { /* no AAAA records — ok */ }

    return true;
  } catch {
    return false;
  }
}
