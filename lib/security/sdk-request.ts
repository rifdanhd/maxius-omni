import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import { readLimitedStream, DOCUMENT_LIMIT } from "./validate-upload";

// Compatibility boundary for the generated SDK; no deprecated request dependency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated SDK callbacks deserialize the untyped JSON boundary
function sdkRequest(options: sdkRequest.Options, callback: (error: Error | null, response: IncomingMessage, body: any) => void): void {
  void execute(options).then(({ response, body }) => callback(null, response, body), error => callback(error instanceof Error ? error : new Error("SDK request failed"), new IncomingMessage(new Socket()), null));
}

async function filePart(value: unknown): Promise<Blob | string> {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return new Blob([new Uint8Array(value)]);
  if (value instanceof Readable) return new Blob([(await readLimitedStream(Readable.toWeb(value) as ReadableStream<Uint8Array>, DOCUMENT_LIMIT)).buffer as ArrayBuffer]);
  throw new Error("Unsupported multipart file.");
}

export async function execute(options: sdkRequest.Options) {
  const url = new URL(options.uri ?? options.url ?? "");
  if (url.protocol !== "https:" || !["open-api.tiktokglobalshop.com", "auth.tiktok-shops.com"].includes(url.hostname)) throw new Error("Untrusted SDK endpoint.");
  for (const [key, value] of Object.entries(options.qs ?? {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const headers = new Headers(options.headers);
  if (options.auth) headers.set("authorization", `Basic ${Buffer.from(`${options.auth.username}:${options.auth.password}`).toString("base64")}`);
  let body: BodyInit | undefined;
  if (options.formData) {
    const form = new FormData();
    for (const [key, raw] of Object.entries(options.formData)) {
      const detailed = raw && typeof raw === "object" && "value" in raw ? raw as { value: unknown; options?: { filename?: string; contentType?: string } } : null;
      const value = await filePart(detailed ? detailed.value : raw);
      if (typeof value === "string") form.set(key, value);
      else form.set(key, detailed?.options?.contentType ? new Blob([value], { type: detailed.options.contentType }) : value, detailed?.options?.filename ?? "upload");
    }
    body = form;
    headers.delete("content-type");
  } else if (options.form) {
    body = new URLSearchParams(Object.entries(options.form).map(([k, v]) => [k, String(v)]));
    headers.set("content-type", "application/x-www-form-urlencoded");
  } else if (options.body !== undefined) {
    body = options.json ? JSON.stringify(options.body) : String(options.body);
  }
  const res = await fetch(url, { method: options.method ?? "GET", headers, body, redirect: "error", signal: AbortSignal.timeout(Math.min(options.timeout ?? 10_000, 10_000)) });
  const bytes = await readLimitedStream(res.body, DOCUMENT_LIMIT);
  const text = Buffer.from(bytes).toString("utf8");
  const response = new IncomingMessage(new Socket());
  response.statusCode = res.status;
  res.headers.forEach((v, k) => { response.headers[k] = v; });
  return { response, body: options.json ? JSON.parse(text) : text };
}

// eslint-disable-next-line @typescript-eslint/no-namespace -- type merge preserves the generated SDK Options contract
namespace sdkRequest {
  export type Response = IncomingMessage;
  export interface Options {
    uri?: string;
    url?: string;
    method?: string;
    qs?: Record<string, unknown>;
    headers?: Record<string, string>;
    body?: object | string;
    form?: Record<string, unknown>;
    formData?: Record<string, unknown>;
    json?: boolean;
    useQuerystring?: boolean;
    timeout?: number;
    auth?: { username: string; password: string };
  }
}
export default sdkRequest;
