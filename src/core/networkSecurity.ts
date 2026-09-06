import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

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

/**
 * Validates that a URL is safe to fetch (not targeting internal networks).
 * @param url The URL string to validate
 * @param allowLocalhost Whether to allow localhost / 127.0.0.1 for local dev/testing (defaults to true if NODE_ENV === 'test')
 * @throws Error if the URL is invalid or targets a blocked host/IP
 */
export function validateRemoteUrl(url: string, allowLocalhost: boolean = process.env['NODE_ENV'] === 'test'): void {
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

  if (allowLocalhost && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
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
}

/**
 * Fetches a remote resource with SSRF protection, timeout, and size limits.
 * @throws Error on invalid URL, blocked host, timeout, or oversized response
 */
export async function fetchRemoteResource(url: string): Promise<Buffer> {
  validateRemoteUrl(url);

  const response = await fetch(url, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)} fetching ${url}`);
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

/**
 * Decodes a data: URI with size limit enforcement.
 * @throws Error on invalid data URI or oversized payload
 */
export function decodeDataUri(uri: string): Buffer {
  const match = uri.match(/base64,(.*)/s);
  if (!match?.[1]) {
    throw new Error('Invalid data: URI');
  }
  // Base64 encodes ~4/3 of the raw size
  if (match[1].length > MAX_DATA_URI_SIZE * 1.4) {
    throw new Error(`Data URI too large: ${String(match[1].length)} chars`);
  }
  return Buffer.from(match[1], 'base64');
}

/**
 * Reads a local file restricted to the current working directory.
 * @throws Error if the resolved path is outside process.cwd()
 */
export function readLocalFile(src: string): Buffer {
  const fullPath = resolve(src);
  if (!fullPath.startsWith(process.cwd())) {
    throw new Error(`File path outside working directory: ${src}`);
  }
  return readFileSync(fullPath);
}
