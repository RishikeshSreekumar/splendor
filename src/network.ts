import { lookup as resolveHost } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export interface NetworkRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface NetworkResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}
export function validateNetworkRequest(input: unknown): NetworkRequest {
  if (!input || typeof input !== 'object') throw new Error('Invalid fetch request');
  const r = input as NetworkRequest;
  if (typeof r.url !== 'string' || r.url.length > 8192) throw new Error('Invalid URL');
  const url = new URL(r.url);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Use a public HTTPS URL on port 443');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host))
    throw new Error('Private and reserved addresses are unavailable');
  const method = r.method ?? 'GET';
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method))
    throw new Error('Unsupported HTTP method');
  if (
    r.body !== undefined &&
    (typeof r.body !== 'string' ||
      Buffer.byteLength(r.body) > MAX_REQUEST_BYTES ||
      ['GET', 'HEAD'].includes(method))
  )
    throw new Error('Invalid or oversized request body');
  const headers = r.headers ?? {};
  if (
    !headers ||
    typeof headers !== 'object' ||
    Array.isArray(headers) ||
    Object.keys(headers).length > 32
  )
    throw new Error('Invalid headers');
  let size = 0;
  for (const [name, value] of Object.entries(headers)) {
    if (
      !/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(name) ||
      typeof value !== 'string' ||
      /[\r\n\0]/.test(value)
    )
      throw new Error('Invalid header');
    if (
      /^(host|connection|content-length|transfer-encoding|upgrade|proxy-.*|accept-encoding|expect|trailer|te)$/i.test(
        name,
      )
    )
      throw new Error('Unsupported header');
    size += Buffer.byteLength(name + value);
  }
  if (size > 16384) throw new Error('Headers exceed 16 KiB');
  return { url: url.href, method, headers, body: r.body };
}
/** Resolve once, validate every answer, then pin the connection to a validated address. No redirects. */
export async function publicFetch(input: unknown, signal: AbortSignal): Promise<NetworkResponse> {
  const r = validateNetworkRequest(input),
    url = new URL(r.url),
    host = url.hostname.replace(/^\[|\]$/g, '');
  signal.throwIfAborted();
  const addresses = await resolveHost(host, { all: true, verbatim: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error('Private and reserved addresses are unavailable');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: r.method,
        headers: { ...r.headers, 'accept-encoding': 'identity' },
        agent: false,
        signal,
        // The validated result is reused, preventing DNS rebinding between validation and connect.
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        family: address.family,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            response.destroy(new Error('Response exceeds 1 MiB'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([k, v]) => [
                k,
                Array.isArray(v) ? v.join(', ') : (v ?? ''),
              ]),
            ),
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(r.body);
  });
}
