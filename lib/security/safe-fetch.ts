import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export class SafeFetchError extends Error {}

export function isPublicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    // Only global unicast. Reject mapped/transition/documentation ranges too.
    const first = parseInt(address.split(":")[0], 16);
    return first >= 0x2000 && first <= 0x3fff &&
      !/^2001:(?:0*:|db8:|0?2:|1[0-9a-f]:)/i.test(address) && !/^2002:/i.test(address);
  }
  return false;
}

export function validateFetchUrl(raw: string | URL, allowedDomains?: readonly string[]): URL {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && !["80", "443"].includes(url.port))) throw new SafeFetchError("URL tidak diizinkan.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host) && !isPublicIp(host)) throw new SafeFetchError("Alamat jaringan privat tidak diizinkan.");
  if (allowedDomains && !allowedDomains.some(d => host === d || host.endsWith(`.${d}`))) {
    throw new SafeFetchError("Domain tidak diizinkan.");
  }
  return url;
}

export async function resolvePublicTarget(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const results = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  if (!results.length || results.some(r => !isPublicIp(r.address))) {
    throw new SafeFetchError("Alamat jaringan privat tidak diizinkan.");
  }
  return results[0];
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  allowedDomains?: readonly string[];
}

export async function safeFetch(raw: string | URL, options: SafeFetchOptions = {}) {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 10_000, 10_000);
  let url = validateFetchUrl(raw, options.allowedDomains);
  for (let redirects = 0; ; redirects++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SafeFetchError("Request timeout.");
    const target = await Promise.race([
      resolvePublicTarget(url),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new SafeFetchError("DNS timeout.")), remaining);
        timer.unref();
      }),
    ]);
    const result = await new Promise<{ status: number; headers: Headers; body: Buffer }>((resolve, reject) => {
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = request(url, {
        agent: false,
        headers: { ...options.headers, "accept-encoding": "identity" },
        // Pin the validated address. TLS still validates the original hostname.
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
      }, res => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = res.statusCode ?? 502;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.destroy();
          resolve({ status, headers, body: Buffer.alloc(0) });
          return;
        }
        if (Number(headers.get("content-length")) > maxBytes ||
            (headers.has("content-encoding") && headers.get("content-encoding") !== "identity")) {
          res.destroy(new SafeFetchError("Respons terlalu besar atau terkompresi."));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) res.destroy(new SafeFetchError("Respons terlalu besar."));
          else chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
        res.on("aborted", () => reject(new SafeFetchError("Respons terputus.")));
      });
      const timer = setTimeout(() => req.destroy(new SafeFetchError("Request timeout.")), Math.max(1, deadline - Date.now()));
      req.on("error", reject);
      req.on("close", () => clearTimeout(timer));
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (redirects >= Math.min(options.maxRedirects ?? 3, 3) || !result.headers.get("location")) {
        throw new SafeFetchError("Terlalu banyak redirect.");
      }
      const next = validateFetchUrl(new URL(result.headers.get("location")!, url), options.allowedDomains);
      if (url.protocol === "https:" && next.protocol !== "https:") throw new SafeFetchError("Redirect downgrade tidak diizinkan.");
      url = next;
      continue;
    }
    return { ...result, url: url.href, ok: result.status >= 200 && result.status < 300 };
  }
}
