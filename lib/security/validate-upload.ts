import { safeFetch } from "./safe-fetch";

export class UploadValidationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const IMAGE_LIMIT = 5 * 1024 * 1024;
export const DOCUMENT_LIMIT = 10 * 1024 * 1024;

export async function readLimitedStream(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!stream) throw new UploadValidationError("File kosong.");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new UploadValidationError("File terlalu besar.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!total) throw new UploadValidationError("File kosong.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function detectFileMime(bytes: Uint8Array): string | null {
  const buf = Buffer.from(bytes);
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export function validateFileBytes(bytes: Uint8Array, declaredType: string, documents = false) {
  if (!bytes.length) throw new UploadValidationError("File kosong.");
  const mime = detectFileMime(bytes);
  const allowed = ["image/jpeg", "image/png", "image/webp", ...(documents ? ["application/pdf"] : [])];
  if (!mime || !allowed.includes(mime) || declaredType.split(";")[0].toLowerCase() !== mime) {
    throw new UploadValidationError("Tipe file atau isi file tidak valid.");
  }
  if (bytes.length > (mime === "application/pdf" ? DOCUMENT_LIMIT : IMAGE_LIMIT)) throw new UploadValidationError("File terlalu besar.", 413);
  return mime;
}

export async function readValidatedUpload(req: Request, documents = false) {
  const limit = (documents ? DOCUMENT_LIMIT : IMAGE_LIMIT) + 64 * 1024;
  if (Number(req.headers.get("content-length")) > limit) throw new UploadValidationError("File terlalu besar.", 413);
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new UploadValidationError("Multipart wajib digunakan.");
  const bytes = await readLimitedStream(req.body, limit);
  let form: FormData;
  try {
    form = await new Response(bytes.buffer as ArrayBuffer, { headers: { "content-type": req.headers.get("content-type")! } }).formData();
  } catch { throw new UploadValidationError("Multipart tidak valid."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw new UploadValidationError("Field file wajib diisi.");
  if (!file.size || file.size > (documents ? DOCUMENT_LIMIT : IMAGE_LIMIT)) throw new UploadValidationError("Ukuran file tidak valid.", 413);
  const buffer = Buffer.from(await readLimitedStream(file.stream(), documents ? DOCUMENT_LIMIT : IMAGE_LIMIT));
  const mime = validateFileBytes(buffer, file.type, documents);
  return { file, buffer, mime, form };
}

export async function downloadValidatedPdf(url: string) {
  const res = await safeFetch(url, { maxBytes: DOCUMENT_LIMIT, headers: { "User-Agent": "maxius-platform/1.0.0" } });
  if (!res.ok) throw new UploadValidationError("Download dokumen gagal.", 502);
  validateFileBytes(res.body, res.headers.get("content-type") ?? "", true);
  if (detectFileMime(res.body) !== "application/pdf") throw new UploadValidationError("Dokumen harus berupa PDF.");
  return res.body;
}
