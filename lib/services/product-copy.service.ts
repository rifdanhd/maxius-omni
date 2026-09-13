import * as cheerio from "cheerio";
import { prisma } from "@/lib/db/prisma";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";

/* ------------------------------------------------------------------ *
 * Product Copy (MVP)
 *
 * Mengambil data produk yang *publicly visible* di halaman HTML produk
 * untuk membantu seller meng-input ulang produknya sendiri. Tidak pernah
 * mem-bypass login/captcha/rate-limit/API privat. Satu URL per request.
 *
 * @see app/(dashboard)/products/copy/page.tsx
 * ------------------------------------------------------------------ */

const FETCH_TIMEOUT_MS = 10_000;
const ROBOTS_TIMEOUT_MS = 4_000;
const MAX_HTML_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES = 12;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface CopyVariant {
  name: string;
  price: number;
  stock: number | null;
  sku?: string;
}

export interface CopyParseResult {
  title: string;
  description: string;
  price: number | null;
  images: string[];
  sourceUrl: string;
  sourcePlatform: string;
  variants: CopyVariant[] | null;
}

export class CopyError extends Error {
  code: "INVALID_URL" | "ROBOTS_BLOCKED" | "FETCH_FAILED" | "NOT_PARSEABLE";
  constructor(code: CopyError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------ Platform ------------------------------ */

export function detectPlatform(host: string): string {
  const h = host.toLowerCase();
  if (h.includes("shopee")) return "Shopee";
  if (h.includes("tokopedia")) return "Tokopedia";
  if (h.includes("tiktok")) return "Tokopedia";
  if (h.includes("bukalapak")) return "Bukalapak";
  if (h.includes("lazada")) return "Lazada";
  if (h.includes("blibli")) return "Blibli";
  return "Lainnya";
}

/* ------------------------------- Fetch ------------------------------- */

interface RobotsRule {
  userAgent: string;
  disallows: string[];
}

const robotsCache = new Map<string, { rules: RobotsRule[]; fetchedAt: number }>();

async function fetchRobots(origin: string): Promise<RobotsRule[]> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) return cached.rules;

  const rules: RobotsRule[] = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ROBOTS_TIMEOUT_MS);
    const res = await fetch(`${origin}/robots.txt`, {
      signal: ctrl.signal,
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
    });
    clearTimeout(t);
    if (res.ok) {
      const text = await res.text();
      let current: RobotsRule | null = null;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (key === "user-agent") {
          current = { userAgent: value.toLowerCase(), disallows: [] };
          rules.push(current);
        } else if (key === "disallow" && current) {
          current.disallows.push(value || "/");
        }
      }
    }
  } catch {
    // Gagal baca robots.txt → anggap diizinkan.
  }
  robotsCache.set(origin, { rules, fetchedAt: Date.now() });
  return rules;
}

function pathAllowedByRobots(pathname: string, rules: RobotsRule[]): boolean {
  const star = rules.find((r) => r.userAgent === "*");
  if (!star) return true;
  const disallowed = star.disallows.some((d) =>
    d === "*" || d === "" ? pathname === "/" : pathname.startsWith(d)
  );
  return !disallowed;
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "id-ID,id;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) {
      throw new CopyError(
        "FETCH_FAILED",
        `Situs target merespons dengan status ${res.status} (${res.statusText}).`
      );
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !/html|text|json/i.test(contentType)) {
      throw new CopyError("FETCH_FAILED", "Situs target tidak mengembalikan halaman HTML.");
    }
    const html = await res.text();
    if (html.length > MAX_HTML_BYTES) {
      throw new CopyError("FETCH_FAILED", "Halaman target terlalu besar untuk diproses.");
    }
    return { html, finalUrl: res.url || url };
  } catch (e) {
    if (e instanceof CopyError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new CopyError("FETCH_FAILED", "Waktu permintaan habis (timeout 10 detik).");
    }
    throw new CopyError("FETCH_FAILED", "Tidak bisa diakses — cek koneksi atau coba lagi.");
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------- Price normalize ---------------------------- */

/**
 * Normalisasi teks harga Indonesia → integer rupiah.
 * "Rp14.000"→14000, "14000"→14000, "Rp 14rb"→14000, "Rp 1,2jt"→1200000,
 * "Rp 1.500.000"→1500000. Mengembalikan null bila tidak bisa ditafsirkan.
 */
export function normalizePrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;

  const s = String(raw)
    .replace(/\bR(?:p|upiah)\b/gi, " ")
    .replace(/\bIDR\b/gi, " ")
    .replace(/Gratis/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  // Satu token angka opsional diikuti suffix satuan (rb/ribu/jt/juta/milyar).
  const suffixMap: Record<string, number> = {
    rb: 1000,
    ribu: 1000,
    k: 1000,
    jt: 1_000_000,
    juta: 1_000_000,
    jutaan: 1_000_000,
    mln: 1_000_000,
    mil: 1_000_000_000,
    milyar: 1_000_000_000,
  };
  const re = /(\d+(?:[.,]\d{1,3})*)\s*(rb|ribu|k|jt|juta|jutaan|mln|mil|milyar)?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s)) !== null) {
    const numeral = match[1];
    const suffix = match[2] ? match[2].toLowerCase() : "";
    const mult = suffix ? suffixMap[suffix] ?? 1 : 1;
    const num = parseNumeral(numeral);
    if (num !== null) return Math.round(num * mult);
  }
  return null;
}

function parseNumeral(token: string): number | null {
  const hasDot = token.includes(".");
  const hasComma = token.includes(",");
  let digits = "";
  if (hasComma && hasDot) {
    const lastComma = token.lastIndexOf(",");
    const decimals = token.slice(lastComma + 1);
    if (decimals.length > 0 && decimals.length <= 2) {
      digits = token.slice(0, lastComma).replace(/\./g, "") + "." + decimals;
    } else {
      digits = token.replace(/[.,]/g, "");
    }
  } else if (hasComma) {
    const lastComma = token.lastIndexOf(",");
    const decimals = token.slice(lastComma + 1);
    if (decimals.length > 0 && decimals.length <= 2) {
      digits = token.slice(0, lastComma).replace(/\./g, "") + "." + decimals;
    } else {
      digits = token.replace(/,/g, "");
    }
  } else if (hasDot) {
    const trail = token.slice(token.lastIndexOf(".") + 1);
    // Format Indonesia: "14.000" (pemisah ribuan, trailing 3 digit), "1.5jt" (desimal 1 digit).
    if (trail.length === 3) digits = token.replace(/\./g, "");
    else digits = token.replace(/\./g, "").slice(0, -trail.length) + (trail ? "." + trail : "");
  } else {
    digits = token;
  }
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------------------------- HTML parsing ---------------------------- */

interface LayerResult {
  title?: string;
  description?: string;
  price?: number | null;
  images: string[];
  variants?: CopyVariant[] | null;
}

function firstDefined<T>(...vals: Array<T | null | undefined>): T | null | undefined {
  return vals.find(
    (v) => v !== null && v !== undefined && !(typeof v === "string" && v === "")
  );
}

function cleanText(s: string | null | undefined, maxLen = 5000): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function resolveImage(href: string, base: URL): string | null {
  const h = href.trim();
  if (!h) return null;
  let out = h;
  try {
    if (h.startsWith("//")) out = base.protocol + h;
    else if (/^https?:\/\//i.test(h)) out = h;
    else if (h.startsWith("/")) out = base.origin + h;
    else return null;
    const u = new URL(out);
    const cleanPath = u.pathname;
    const searchOnly = u.search.length >= 8 ? u.search : "";
    u.search = searchOnly;
    u.pathname = cleanPath;
    return u.href;
  } catch {
    return null;
  }
}

/** JSON-LD: offers bisa array (multi-varian) atau AggregateOffer.offers. */
function extractJsonLdVariants(offers: Array<Record<string, unknown>> | null): CopyVariant[] | null {
  if (!offers || offers.length < 2) return null;
  const vs: CopyVariant[] = [];
  const seen = new Set<string>();
  for (const o of offers) {
    if (!o || typeof o !== "object") continue;
    const price = normalizePrice(o.price as string | number | null | undefined);
    if (price === null) continue;
    const sub =
      o.itemOffered && typeof o.itemOffered === "object"
        ? (o.itemOffered as Record<string, unknown>)
        : null;
    const nameRaw = [o.name, sub?.name].find((x) => typeof x === "string" && x.trim());
    const skuRaw = [o.sku, sub?.sku].find((x) => typeof x === "string" && x.trim());
    const name =
      typeof nameRaw === "string" && nameRaw ? nameRaw.trim().slice(0, 200) : `Varian ${vs.length + 1}`;
    const key = (typeof skuRaw === "string" ? skuRaw : name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    vs.push({
      name,
      price,
      stock: null,
      ...(typeof skuRaw === "string" && skuRaw ? { sku: skuRaw } : {}),
    });
  }
  return vs.length >= 2 ? vs : null;
}

function parseJsonLd($: cheerio.CheerioAPI, base: URL): LayerResult {
  const images: string[] = [];
  let title = "";
  let description = "";
  let price: number | null = null;
  let variants: CopyVariant[] | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).text();
    if (!text.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const node of items) {
      if (!node || typeof node !== "object") continue;
      const type = Array.isArray((node as { "@type"?: unknown })["@type"])
        ? ((node as { "@type": string[] })["@type"] ?? []).map((x) => String(x).toLowerCase())
        : [String((node as { "@type"?: unknown })["@type"] ?? "").toLowerCase()];
      if (!type.some((t) => t.includes("product"))) continue;
      const p = node as {
        name?: unknown;
        description?: unknown;
        image?: unknown;
        offers?: unknown;
      };
      if (!title && typeof p.name === "string") title = cleanText(p.name, 500);
      if (!description && typeof p.description === "string")
        description = cleanText(p.description);
      if (p.offers && typeof p.offers === "object") {
        const offersArr = Array.isArray(p.offers)
          ? (p.offers as Array<Record<string, unknown>>)
          : Array.isArray((p.offers as Record<string, unknown>)["offers"])
            ? ((p.offers as Record<string, unknown>)["offers"] as Array<Record<string, unknown>>)
            : null;
        if (price === null && offersArr && offersArr.length > 0) {
          price = normalizePrice(
            offersArr[0]?.price as string | number | null | undefined
          );
        }
        if (price === null) {
          const off = p.offers as { price?: unknown; lowPrice?: unknown; highPrice?: unknown };
          price = normalizePrice(
            (off.price ?? off.lowPrice ?? off.highPrice) as
              | string
              | number
              | null
              | undefined
          );
        }
        if (!variants) {
          const vs = extractJsonLdVariants(offersArr);
          if (vs) variants = vs;
        }
      }
      const imgs = Array.isArray(p.image)
        ? p.image
        : p.image
          ? [p.image]
          : [];
      for (const img of imgs) {
        if (typeof img === "string") {
          const u = resolveImage(img, base);
          if (u) images.push(u);
        } else if (img && typeof img === "object") {
          const url = (img as { url?: unknown }).url;
          if (typeof url === "string") {
            const u = resolveImage(url, base);
            if (u) images.push(u);
          }
        }
      }
    }
  });

  return { title, description, price, images: dedupe(images), variants };
}

/** Cari objek JSON yang dimuat ke dalam `<script>` lewat global state. */
function extractStateScripts(html: string): unknown[] {
  const markers = [
    "__UNIVERSAL_DATA_FOR_REHYDRATION__",
    "__INITIAL_STATE__",
    "__initial_state__",
    "__NEXT_DATA__",
    "__init_data__",
  ];
  const found: unknown[] = [];
  for (const marker of markers) {
    let from = 0;
    while (true) {
      const idx = html.indexOf(marker, from);
      if (idx === -1) break;
      const open = html.indexOf("{", idx + marker.length);
      if (open !== -1) {
        const maybe = html.slice(open);
        const obj = readBalancedJson(maybe);
        if (obj !== null) {
          try {
            found.push(JSON.parse(obj));
          } catch {
            /* lanjut ke marker berikutnya */
          }
        }
      }
      from = idx + marker.length;
    }
  }
  return found;
}

function readBalancedJson(input: string): string | null {
  let depth = 0;
  let i = 0;
  let inStr = false;
  let esc = false;
  for (; i < input.length; i++) {
    const ch = input[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return input.slice(0, i + 1);
    }
  }
  return null;
}

const STATE_TITLE_KEYS = /^(name|title|display_name|product_name)$/i;
const STATE_PRICE_KEYS = /^(price|price_min|min_price|sale_price|price_now|price_display)$/i;
const STATE_DESC_KEYS = /^description$/i;
const STATE_IMG_KEYS = /^(image|images|image_url|image_list|photo|gallery|cover|thumbnail|imgs|images_urls)$/i;

function pickTitle(s: string): string | null {
  const t = cleanText(s, 500);
  if (t.length < 8) return null;
  if (t.length > 4 && t.trim().split(/\s+/).length >= 2) return t;
  return null;
}

function walkState(node: unknown, key: string, depth: number, acc: LayerResult): void {
  if (depth > 7) return;
  if (node === null || node === undefined) return;

  if (typeof node === "string") {
    const s = node;
    if (!acc.title && STATE_TITLE_KEYS.test(key)) {
      const t = pickTitle(s);
      if (t) acc.title = t;
    } else if (!acc.description && STATE_DESC_KEYS.test(key) && s.length > 25) {
      acc.description = cleanText(s);
    } else if (STATE_IMG_KEYS.test(key)) {
      if (s.startsWith("http") || s.startsWith("//")) acc.images.push(s);
    }
    return;
  }

  if (typeof node === "number") {
    if (acc.price === null && STATE_PRICE_KEYS.test(key)) acc.price = normalizePrice(node);
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) walkState(item, key, depth + 1, acc);
    return;
  }

  if (typeof node === "object") {
    const entries = Object.entries(node as Record<string, unknown>);
    for (const [k, v] of entries) walkState(v, k, depth + 1, acc);
    if (acc.price === null) {
      const priceStr = entries.find(
        ([k, v]) => STATE_PRICE_KEYS.test(k) && typeof v === "string"
      ) as [string, string] | undefined;
      if (priceStr) acc.price = normalizePrice(priceStr[1]);
      else {
        const priceObj = entries.find(
          ([k, v]) =>
            STATE_PRICE_KEYS.test(k) && v !== null && typeof v === "object"
        ) as [string, Record<string, unknown>] | undefined;
        if (priceObj) {
          const o = priceObj[1];
          acc.price = normalizePrice(
            (o.value ?? o.sale_price ?? o.original_price ?? o.amount ?? o.format ?? o.text) as
              | string
              | number
              | null
              | undefined
          );
        }
      }
    }
  }
}

function parseStateGlobal(states: unknown[]): LayerResult {
  const acc: LayerResult = { images: [], price: null, variants: null };
  for (const state of states) {
    walkState(state, "", 0, acc);
    if (!acc.variants) acc.variants = collectStateSkus(state);
  }
  return acc;
}

/* ------------------------- State: variant (skus) ------------------------- */

function isSkuObject(node: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const o = node as Record<string, unknown>;
  return (
    "seller_sku" in o ||
    "sale_props" in o ||
    "sales_attributes" in o ||
    "stock_info" in o ||
    "inventory" in o ||
    "sku_id" in o
  );
}

function skuPrice(sku: Record<string, unknown>): number | null {
  const price = sku.price;
  if (price === null || price === undefined) return null;
  if (typeof price === "number" || typeof price === "string") return normalizePrice(price);
  if (typeof price === "object") {
    const o = price as Record<string, unknown>;
    return normalizePrice(
      (o.value ?? o.sale_price ?? o.original_price ?? o.amount ?? o.format ?? o.text) as
        | string
        | number
        | null
        | undefined
    );
  }
  return null;
}

function skuStock(sku: Record<string, unknown>): number | null {
  const stockInfo = sku.stock_info;
  if (stockInfo && typeof stockInfo === "object") {
    const s = (stockInfo as Record<string, unknown>).stock;
    if (typeof s === "number" && Number.isFinite(s)) return Math.max(0, Math.round(s));
    if (typeof s === "string" && s.trim() !== "" && Number.isFinite(Number(s)))
      return Math.max(0, Math.round(Number(s)));
  }
  if (typeof sku.stock === "number" && Number.isFinite(sku.stock)) return Math.max(0, Math.round(sku.stock));
  const inv = Array.isArray(sku.inventory) ? sku.inventory : [];
  if (inv.length > 0) {
    const sum = inv.reduce(
      (acc, e) => acc + (Number((e as { quantity?: unknown }).quantity) || 0),
      0
    );
    return Math.max(0, Math.round(sum));
  }
  if (typeof sku.available_stock === "number" && Number.isFinite(sku.available_stock))
    return Math.max(0, Math.round(sku.available_stock));
  return null;
}

function skuVariantName(sku: Record<string, unknown>, index: number): string {
  const attrs = Array.isArray(sku.sale_props)
    ? sku.sale_props
    : Array.isArray(sku.sales_attributes)
      ? sku.sales_attributes
      : [];
  const names = attrs
    .map((a) =>
      String((a as { value_name?: unknown })?.value_name ?? (a as { valueName?: unknown })?.valueName ?? "")
    )
    .filter(Boolean);
  if (names.length > 0) return names.join(" - ");
  if (typeof sku.seller_sku === "string" && sku.seller_sku.trim()) return sku.seller_sku.trim();
  return `Varian ${index + 1}`;
}

function skuExternalId(sku: Record<string, unknown>): string | undefined {
  for (const k of ["sku_id", "id", "seller_sku", "sku_code"]) {
    const v = sku[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** Kumpulkan varian dari array `skus` di dalam global state (rehydration web). */
function collectStateSkus(root: unknown): CopyVariant[] | null {
  const out: CopyVariant[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, depth: number): void => {
    if (depth > 12 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (isSkuObject(item)) {
          const sku = item as Record<string, unknown>;
          const price = skuPrice(sku);
          if (price === null) continue;
          const key = (skuExternalId(sku) ?? skuVariantName(sku, out.length)).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            name: skuVariantName(sku, out.length),
            price,
            stock: skuStock(sku),
            ...(skuExternalId(sku) ? { sku: skuExternalId(sku) } : {}),
          });
        } else {
          visit(item, depth + 1);
        }
      }
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (/^skus$/i.test(k) && Array.isArray(v)) {
          visit(v, depth + 1);
        } else {
          visit(v, depth + 1);
        }
      }
    }
  };

  visit(root, 0);
  return out.length >= 2 ? out : null;
}

function parseOgMeta($: cheerio.CheerioAPI, base: URL): LayerResult {
  const images: string[] = [];
  const pick = (prop: string): string | null => {
    const node = $(`meta[property="${prop}"]`).attr("content") ?? $(`meta[name="${prop}"]`).attr("content");
    return node ? cleanText(node) : null;
  };
  const ogImage = pick("og:image");
  if (ogImage) {
    const u = resolveImage(ogImage, base);
    if (u) images.push(u);
  }
  for (const sec of ["og:image:secure_url", "og:image:url"]) {
    const v = pick(sec);
    if (v) {
      const u = resolveImage(v, base);
      if (u) images.push(u);
    }
  }
  return {
    title: pick("og:title") ?? undefined,
    description: pick("og:description") ?? pick("description") ?? undefined,
    images: dedupe(images),
  };
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

export function parseProductHtml(html: string, finalUrl: string): CopyParseResult {
  const base = new URL(finalUrl);
  const $ = cheerio.load(html);

  const titleTag = cleanText($("title").first().text() ?? "", 500);

  const jsonLd = parseJsonLd($, base);
  const stateResult = parseStateGlobal(extractStateScripts(html));
  const ogMeta = parseOgMeta($, base);

  const title =
    cleanText(firstDefined(jsonLd.title, stateResult.title) ?? ogMeta.title ?? titleTag ?? "");
  const description = cleanText(
    firstDefined(jsonLd.description, stateResult.description) ?? ogMeta.description ?? ""
  );
  const price = firstDefined(jsonLd.price, stateResult.price) ?? null;
  const images = dedupe([...jsonLd.images, ...stateResult.images, ...ogMeta.images]);
  const variants = jsonLd.variants ?? stateResult.variants ?? null;

  const hasImage = images.length > 0;
  const meaningful = Boolean(title && (description || price !== null || hasImage));

  if (!meaningful) {
    throw new CopyError(
      "NOT_PARSEABLE",
      "Data tidak bisa diambil otomatis, silakan isi manual."
    );
  }

  return {
    title: title || "Produk tanpa judul",
    description,
    price,
    images: dedupe(images).slice(0, MAX_IMAGES),
    sourceUrl: finalUrl,
    sourcePlatform: detectPlatform(base.hostname),
    variants,
  };
}

/* ------------------------------ Public API ------------------------------ */

export async function parseProductFromUrl(rawUrl: string): Promise<CopyParseResult> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new CopyError("INVALID_URL", "URL tidak valid. Masukkan URL lengkap (http/https).");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new CopyError("INVALID_URL", "Hanya mendukung URL http/https.");
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) {
    throw new CopyError("INVALID_URL", "URL tidak valid.");
  }

  const origin = url.origin;
  const pathname = url.pathname || "/";
  const rules = await fetchRobots(origin);
  if (!pathAllowedByRobots(pathname, rules)) {
    throw new CopyError(
      "ROBOTS_BLOCKED",
      "Halaman ini diblokir oleh robots.txt situs target, jadi tidak bisa diambil otomatis."
    );
  }

  const { html, finalUrl } = await fetchHtml(url.href);
  return parseProductHtml(html, finalUrl);
}

/* --------------------------------- Save --------------------------------- */

export interface CopyVariantInput {
  name?: string;
  price?: number | null;
  stock?: number | null;
  sku?: string | null;
}

export interface SaveDraftInput {
  name: string;
  description?: string;
  price?: number | null;
  imageUrl?: string | null;
  images?: string[];
  sourceUrl?: string | null;
  category?: string | null;
  variants?: CopyVariantInput[];
}

function slugBase(s: string): string {
  const cleaned = s
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 40);
  return cleaned || "VARIAN";
}

function cleanSku(raw: string | null | undefined): string | null {
  const s = String(raw ?? "")
    .trim()
    .slice(0, 64);
  return s || null;
}

/** SKU draft tunggal (tanpa varian), sesuai pola lama DRAFT-<timestamp>. */
function draftSkuTimestamp(): string {
  return `DRAFT-${Date.now().toString(36).toUpperCase()}`;
}

/** Susun varian unik (idempoten): dedupe by SKU; SKU kosong digenerate dari nama. */
function buildVariantSkus(
  title: string,
  variants: CopyVariantInput[]
): Array<{ name: string; price: number | null; stock: number; sku: string }> {
  const used = new Set<string>();
  const out: Array<{ name: string; price: number | null; stock: number; sku: string }> = [];
  for (const v of variants) {
    const name = String(v.name ?? "").trim().slice(0, 120);
    const price =
      typeof v.price === "number" && Number.isFinite(v.price) && v.price > 0
        ? Math.round(v.price)
        : null;
    const stock =
      typeof v.stock === "number" && Number.isFinite(v.stock) && Math.round(v.stock) >= 0
        ? Math.round(v.stock)
        : 0;
    let sku = cleanSku(v.sku);
    if (!sku) {
      sku = `DRAFT-${slugBase(`${title} ${name}`)}`;
      if (used.has(sku.toLowerCase())) sku += `-${out.length + 1}`;
    }
    if (used.has(sku.toLowerCase())) {
      let n = 2;
      let candidate = `${sku}-${n}`;
      while (used.has(candidate.toLowerCase())) {
        n++;
        candidate = `${sku}-${n}`;
      }
      sku = candidate;
    }
    used.add(sku.toLowerCase());
    out.push({ name, price, stock, sku });
  }
  return out;
}

export async function saveProductCopyAsDraft(input: SaveDraftInput): Promise<{ id: string }> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new CopyError("NOT_PARSEABLE", "Nama produk wajib diisi.");

  const images = (input.images ?? [])
    .map((i) => String(i).trim())
    .filter((i) => /^https?:\/\//i.test(i))
    .slice(0, MAX_IMAGES);
  const imageUrl = String(input.imageUrl ?? "").trim() || images[0] || null;

  const variants = Array.isArray(input.variants) ? buildVariantSkus(name, input.variants) : null;
  const variantsForCreate =
    variants && variants.length > 0
      ? variants.map((v) => ({
          sku: v.sku,
          name: v.name || null,
          stock: v.stock,
          ...(v.price !== null ? { price: v.price } : {}),
        }))
      : [
          {
            sku: draftSkuTimestamp(),
            name: null,
            stock: 0,
            ...(typeof input.price === "number" && Number.isFinite(input.price)
              ? { price: input.price }
              : {}),
          },
        ];

  return await prisma.$transaction(async (tx) => {
    // Ambang awal produk baru = setting global Pengaturan Inventori.
    const settings = await getCachedInventorySettings();
    const product = await tx.masterProduct.create({
      data: {
        name,
        threshold: settings.lowStockDefaultThreshold,
        category: input.category ? String(input.category).trim() : null,
        imageUrl,
        status: "draft",
        importedFrom: input.sourceUrl ? String(input.sourceUrl).trim() : null,
        variants: { create: variantsForCreate },
        images: {
          create: images.map((url, i) => ({
            url,
            isCover: i === 0,
            order: i,
          })),
        },
      },
      select: { id: true },
    });
    return { id: product.id };
  });
}