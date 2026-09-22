import { resolve, relative, isAbsolute } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Maximum size for remote resources (50 MB) */
const MAX_RESOURCE_SIZE: number = 50 * 1024 * 1024;

/** Maximum size for data: URI payloads (10 MB) */
const MAX_DATA_URI_SIZE: number = 10 * 1024 * 1024;

/** Network request timeout (30 seconds) */
const NETWORK_TIMEOUT_MS: number = 30_000;

const BLOCKED_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'metadata.google.internal',
  'metadata.internal',
]);

const BLOCKED_IP_PREFIXES: readonly string[] = [
  '10.',
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
  '192.168.',
  '169.254.',
  'fd',
  'fe80:',
] as const;

export interface ValidateRemoteUrlOptions {
  allowLocalhost?: boolean;
  allowedLocalIps?: readonly string[];
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = parseInt(part, 10);
    if (n < 0 || n > 255 || String(n) !== part) return null;
    num = ((num << 8) + n) >>> 0;
  }
  return num;
}

function matchesCidr(ip: string, cidr: string): boolean {
  const slashIdx = cidr.indexOf('/');
  if (slashIdx === -1) return false;
  const range = cidr.substring(0, slashIdx);
  const bitsStr = cidr.substring(slashIdx + 1);
  if (!range || !bitsStr || !/^\d+$/.test(bitsStr)) return false;
  const bits = parseInt(bitsStr, 10);
  if (bits < 0 || bits > 32) return false;

  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);
  if (ipNum === null || rangeNum === null) return false;

  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : ~((1 << (32 - bits)) - 1) >>> 0;
  return (ipNum & mask) >>> 0 === (rangeNum & mask) >>> 0;
}

/**
 * Checks whether an IP belongs to private, loopback, link-local or reserved subnets.
 */
export function isPrivateOrBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (!version) return false;

  if (version === 4) {
    if (ip === '0.0.0.0' || ip.startsWith('0.')) return true;
    if (ip === '127.0.0.1' || ip.startsWith('127.')) return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('169.254.')) return true;

    const parts = ip.split('.').map(Number);
    // 172.16.0.0 - 172.31.255.255
    if (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31) return true;
    // 100.64.0.0/10 Carrier-grade NAT
    if (parts[0] === 100 && parts[1] !== undefined && parts[1] >= 64 && parts[1] <= 127) return true;
    // 192.0.0.0/24 & 192.0.2.0/24
    if (parts[0] === 192 && parts[1] === 0) return true;
    // 198.18.0.0/15 benchmarking, 198.51.100.0/24
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51)) return true;
    // 203.0.113.0/24
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // Multicast & Reserved (>= 224.0.0.0)
    if (parts[0] !== undefined && parts[0] >= 224) return true;

    return false;
  }

  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1') return true;
    if (
      lower.startsWith('fe80:') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    )
      return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) {
      const v4Part = lower.slice(7);
      if (isIP(v4Part) === 4) {
        return isPrivateOrBlockedIp(v4Part);
      }
    }
    return false;
  }

  return false;
}

/**
 * Checks if a hostname or IP is included in the allowed local IP / host list.
 * Supports exact match, CIDR (e.g. 192.168.1.0/24), wildcards (*.corp, 192.168.1.*, *), and hostnames.
 */
export function isIpOrHostAllowed(hostname: string, allowedList: readonly string[]): boolean {
  const target = hostname.toLowerCase();
  for (const item of allowedList) {
    let trimmed = item.trim().toLowerCase();
    if (!trimmed) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      trimmed = trimmed.slice(1, -1);
    }

    if (trimmed === '*' || trimmed === 'all') {
      return true;
    }

    if (target === trimmed) {
      return true;
    }

    if (trimmed.startsWith('*.') && target.endsWith(trimmed.slice(1))) {
      return true;
    }

    if (trimmed.includes('/')) {
      if (matchesCidr(target, trimmed)) {
        return true;
      }
      continue;
    }

    if (trimmed.endsWith('.*')) {
      const prefix = trimmed.slice(0, -1);
      if (target.startsWith(prefix)) {
        return true;
      }
    } else if (trimmed.endsWith('.')) {
      if (target.startsWith(trimmed)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validates that a URL is safe to fetch (not targeting internal networks unless whitelisted).
 * @param url The URL string to validate
 * @param options Options specifying allowLocalhost and allowedLocalIps, or boolean for allowLocalhost
 * @throws Error if the URL is invalid or targets a blocked host/IP
 */
export function validateRemoteUrl(
  url: string,
  options: ValidateRemoteUrlOptions | boolean = process.env['NODE_ENV'] === 'test',
): void {
  const opts: ValidateRemoteUrlOptions =
    typeof options === 'boolean'
      ? { allowLocalhost: options }
      : {
          allowLocalhost: options?.allowLocalhost ?? process.env['NODE_ENV'] === 'test',
          allowedLocalIps: options?.allowedLocalIps,
        };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']') ? rawHostname.slice(1, -1) : rawHostname;

  if (opts.allowLocalhost && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
    return;
  }

  if (opts.allowedLocalIps && isIpOrHostAllowed(hostname, opts.allowedLocalIps)) {
    return;
  }

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error(`Blocked host: ${hostname}`);
  }

  for (const prefix of BLOCKED_IP_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      throw new Error(`Blocked private/internal IP: ${hostname}`);
    }
  }

  if (isIP(hostname) && isPrivateOrBlockedIp(hostname)) {
    throw new Error(`Blocked private/internal IP: ${hostname}`);
  }
}

/**
 * Resolves DNS for domain names and verifies resolved IP addresses against private networks.
 */
async function resolveAndValidateHost(hostname: string, opts: ValidateRemoteUrlOptions): Promise<void> {
  const isDirectIp = isIP(hostname);
  if (isDirectIp) {
    if (opts.allowLocalhost && (hostname === '127.0.0.1' || hostname === '::1' || hostname.startsWith('127.'))) {
      return;
    }
    if (opts.allowedLocalIps && isIpOrHostAllowed(hostname, opts.allowedLocalIps)) {
      return;
    }
    if (isPrivateOrBlockedIp(hostname)) {
      throw new Error(`Blocked private/internal IP: ${hostname}`);
    }
    return;
  }

  // Domain name: resolve DNS to guard against DNS rebinding attacks
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const addr of addresses) {
      const ip = addr.address;
      if (opts.allowLocalhost && (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.'))) {
        continue;
      }
      if (
        opts.allowedLocalIps &&
        (isIpOrHostAllowed(ip, opts.allowedLocalIps) || isIpOrHostAllowed(hostname, opts.allowedLocalIps))
      ) {
        continue;
      }
      if (isPrivateOrBlockedIp(ip)) {
        throw new Error(`Blocked DNS rebinding to private/internal IP: ${hostname} -> ${ip}`);
      }
    }
  } catch (err) {
    if ((err as Error).message.includes('Blocked')) {
      throw err;
    }
    // DNS resolution failure will be handled by fetch
  }
}

/**
 * Fetches a remote resource with SSRF protection, DNS rebinding checks, manual redirect validation, timeout, and size limits.
 * @throws Error on invalid URL, blocked host, timeout, or oversized response
 */
export async function fetchRemoteResource(
  url: string,
  options?: ValidateRemoteUrlOptions | readonly string[],
): Promise<Buffer> {
  const opts: ValidateRemoteUrlOptions = Array.isArray(options)
    ? { allowedLocalIps: options, allowLocalhost: process.env['NODE_ENV'] === 'test' }
    : {
        allowLocalhost: (options as ValidateRemoteUrlOptions)?.allowLocalhost ?? process.env['NODE_ENV'] === 'test',
        allowedLocalIps: (options as ValidateRemoteUrlOptions)?.allowedLocalIps,
      };

  let currentUrl = url;
  const maxRedirects = 3;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    validateRemoteUrl(currentUrl, opts);

    const parsed = new URL(currentUrl);
    const rawHostname = parsed.hostname.toLowerCase();
    const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']') ? rawHostname.slice(1, -1) : rawHostname;

    await resolveAndValidateHost(hostname, opts);

    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });

    // Check for HTTP redirects (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`HTTP ${String(response.status)} redirect without Location header`);
      }
      if (redirectCount === maxRedirects) {
        throw new Error(`Too many redirects (max ${maxRedirects})`);
      }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)} fetching ${currentUrl}`);
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_RESOURCE_SIZE) {
      throw new Error(`Resource too large: ${String(contentLength)} bytes (max ${String(MAX_RESOURCE_SIZE)})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_RESOURCE_SIZE) {
      throw new Error(`Resource too large: ${String(arrayBuffer.byteLength)} bytes`);
    }

    return Buffer.from(arrayBuffer);
  }

  throw new Error('Failed to fetch resource: exceeded redirect limit');
}

/**
 * Decodes a data: URI with size limit enforcement without greedy regex (ReDoS safe).
 * @throws Error on invalid data URI or oversized payload
 */
export function decodeDataUri(uri: string): Buffer {
  const commaIdx = uri.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Invalid data: URI');
  }

  const meta = uri.slice(0, commaIdx);
  const metaParts = meta.split(';');
  if (!metaParts.includes('base64')) {
    throw new Error('Invalid data: URI');
  }

  const base64Data = uri.slice(commaIdx + 1);
  if (!base64Data) {
    throw new Error('Invalid data: URI');
  }

  // Base64 encodes ~4/3 of the raw size
  if (base64Data.length > MAX_DATA_URI_SIZE * 1.4) {
    throw new Error(`Data URI too large: ${String(base64Data.length)} chars`);
  }

  return Buffer.from(base64Data, 'base64');
}

/**
 * Reads a local file restricted strictly to the current working directory, preventing directory traversal and symlink escapes.
 * @throws Error if the resolved path or canonical path is outside process.cwd()
 */
export function readLocalFile(src: string): Buffer {
  const cwd = process.cwd();
  const fullPath = resolve(src);

  const rel = relative(cwd, fullPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`File path outside working directory: ${src}`);
  }

  let realTarget: string;
  try {
    realTarget = realpathSync(fullPath);
  } catch {
    throw new Error(`File not found or inaccessible: ${src}`);
  }

  let realCwd: string;
  try {
    realCwd = realpathSync(cwd);
  } catch {
    realCwd = cwd;
  }

  const relReal = relative(realCwd, realTarget);
  if (relReal.startsWith('..') || isAbsolute(relReal)) {
    throw new Error(`File path outside working directory: ${src}`);
  }

  return readFileSync(realTarget);
}
