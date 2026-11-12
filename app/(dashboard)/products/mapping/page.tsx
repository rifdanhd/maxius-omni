"use client";

import { ErrorFeedback } from "@/components/ui/feedback";
import { SkuReviewPanel } from "@/components/inventory/sku-review-panel";
import { AutoMatchPanel } from "@/components/inventory/auto-match-panel";
import { notify } from "@/components/ui/notify";
import { confirmAction } from "@/components/ui/confirm-action";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCallback, useEffect, useMemo, useRef, useState, useId, type ReactNode } from "react";
import { authFetch } from "@/lib/utils/api-client";
import {
  Plus,
  Trash2,
  RefreshCw,
  History,
  Save,
  X,
  Link2,
  Boxes,
  SlidersHorizontal,
  AlertTriangle,
  PackagePlus,
  Link as LinkIcon,
  Info,
  Search,
  Store as StoreIcon,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  MousePointerClick,
  type LucideIcon,
} from "lucide-react";

type Store = { id: string; name: string; platform: string; status: string };
type Variant = {
  id: string;
  sku: string;
  stock: number;
  safetyStock: number;
  masterProduct: { id: string; name: string };
};
type Mapping = {
  id: string;
  channelSku: string;
  origin: string | null;
  reviewed: boolean;
  account: { id: string; platform: string; label: string } | null;
  variant: Variant | null;
};
type LedgerEntry = {
  id: string;
  changeQty: number;
  reason: string;
  referenceId: string | null;
  note: string | null;
  stockAfter: number;
  createdAt: string;
  variant: { sku: string; masterProduct: { name: string } } | null;
  account: { label: string; platform: string } | null;
  user: { username: string } | null;
};

const formatPlatform = (p: string) =>
  p === "TIKTOK_SHOP" ? "TikTok Shop" : p === "SHOPEE" ? "Shopee" : p || "-";

const effectiveStock = (v: Variant | null) =>
  v ? Math.max(0, v.stock - v.safetyStock) : 0;

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await authFetch(path, {
    ...opts,
    headers: {

      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Gagal (${res.status})`);
  return data as T;
}

type OrphanSku = {
  channelSku: string;
  accountId: string;
  accountLabel: string | null;
  platform: string | null;
  qty: number;
  orderCount: number;
  sampleProductName: string | null;
  imageUrl: string | null;
  lastSeenAt: string | null;
  existingMappingId: string | null;
};

const orphanKey = (orphan: OrphanSku) => JSON.stringify([orphan.accountId, orphan.channelSku]);
type MappingResult = { stockWarnings?: string[]; reviewRequired?: boolean };
const showStockWarnings = (result: MappingResult) => {
  if (result.stockWarnings?.length) notify("warning", `Mapping tersimpan. Stok pesanan berikut perlu ditinjau:\n${result.stockWarnings.slice(0, 10).join("\n")}`);
};

const emptyForm = {
  accountId: "",
  channelSku: "",
  useNewVariant: false,
  variantId: "",
  newProductName: "",
  sku: "",
  stock: "",
  safetyStock: "",
};

type Selection =
  | { kind: "mapping"; id: string }
  | { kind: "orphan"; key: string }
  | { kind: "variant"; id: string }
  | { kind: "new" }
  | null;

const PAGE_STEP = 50;

/* ───────────────────────── Komponen UI kecil ───────────────────────── */

const field =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="mb-1.5 block text-xs font-semibold text-foreground">{label}</label>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string; icon?: LucideIcon }>;
}) {
  return (
    <div role="group" className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-0.5">
      {options.map(({ id, label, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {Icon && <Icon size={13} aria-hidden="true" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative block w-full">
      <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
      <input className={`${field} pl-9`} aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function VariantSearchSelect({
  value,
  onChange,
  variants,
  placeholder = "Cari nama produk atau SKU pusat...",
  className = "",
}: {
  value: string;
  onChange: (variantId: string) => void;
  variants: Variant[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsId = useId();

  const selected = variants.find((v) => v.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return variants.slice(0, 60);
    return variants
      .filter(
        (v) =>
          v.masterProduct.name.toLowerCase().includes(q) ||
          v.sku.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [variants, query]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div className={`relative min-w-0 ${className}`} ref={dropdownRef} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); } }}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-controls={open ? optionsId : undefined}
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          setQuery("");
        }}
        className="flex min-h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-left text-sm shadow-xs transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {selected ? (
          <div className="flex min-w-0 flex-1 flex-col pr-2">
            <span className="truncate font-semibold text-foreground leading-snug">
              {selected.masterProduct.name}
            </span>
            <span className="truncate text-xs text-muted-foreground font-mono">
              SKU: {selected.sku} · Stok: {selected.stock.toLocaleString("id-ID")}
            </span>
          </div>
        ) : (
          <span className="flex items-center gap-2 text-muted-foreground text-sm">
            <Search size={14} className="shrink-0" />
            <span className="truncate">{placeholder}</span>
          </span>
        )}
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div id={optionsId} className="absolute left-0 top-full z-50 mt-1 max-h-80 w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-in fade-in-0 zoom-in-95">
          <div className="border-b border-border p-2 bg-muted/40">
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs">
              <Search size={14} className="shrink-0 text-muted-foreground" />
              <input
                type="text"
                autoFocus
                aria-label="Cari varian pusat"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ketik nama produk atau SKU varian..."
                className="w-full bg-transparent focus:outline-none text-foreground placeholder:text-muted-foreground text-xs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto p-1 divide-y divide-border/30">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                Tidak ada variasi pusat yang cocok dengan &quot;{query}&quot;.
              </div>
            ) : (
              filtered.map((v) => {
                const isSelected = v.id === value;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      onChange(v.id);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={`flex w-full items-start justify-between gap-3 p-2 text-left transition-colors rounded-md ${
                      isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold leading-tight line-clamp-2" title={v.masterProduct.name}>
                        {v.masterProduct.name}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground font-mono">
                        SKU: <span className="font-semibold text-foreground/80">{v.sku}</span>
                      </p>
                    </div>
                    <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      Stok {v.stock.toLocaleString("id-ID")}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-border bg-muted/40 px-3 py-1.5 text-[10px] text-muted-foreground flex justify-between items-center">
            <span>Ditemukan {filtered.length} varian</span>
            <span>Total {variants.length} variasi pusat</span>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, children, action }: { icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon size={20} aria-hidden="true" />
      </span>
      <p className="max-w-xs text-sm text-muted-foreground">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function StockPill({ value }: { value: number }) {
  return (
    <span
      className={`inline-flex min-w-10 justify-center rounded-md px-2 py-1 text-sm font-bold tabular-nums ${
        value === 0 ? "bg-destructive-subtle text-destructive" : "bg-muted/60 text-foreground"
      }`}
    >
      {value}
    </span>
  );
}

// Badge asal mapping: ditinjau > auto > manual — traceback siapa yang membuat
// hubungan ini (research pola omnichannel: zero unapproved master-link).
const originLabel: Record<string, { label: string; cls: string } | undefined> = {
  review: { label: "Hasil tinjauan", cls: "border-warning/40 text-foreground bg-warning/10" },
  auto: { label: "Otomatis", cls: "border-primary/30 bg-primary/10 text-primary" },
  manual: { label: "Manual", cls: "text-muted-foreground" },
};

function OriginBadge({ mapping }: { mapping: Mapping }) {
  const meta = mapping.reviewed ? originLabel.review : mapping.origin ? originLabel[mapping.origin] : undefined;
  if (!meta) return null;
  return (
    <span
      title={mapping.reviewed ? "Hubungan disatukan melalui antrean tinjauan SKU seller" : mapping.origin === "auto" ? "Dibuat otomatis (auto-match / import marketplace)" : "Dibuat manual lewat form mapping"}
      className={`inline-flex whitespace-nowrap rounded-full border border-transparent px-1.5 py-0 text-[10px] font-semibold leading-[1.4] ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}

function PlatformChip({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-foreground">
      <StoreIcon size={10} className="text-muted-foreground" aria-hidden="true" />
      {formatPlatform(platform)}
    </span>
  );
}

function StatBox({ label, value, danger }: { label: string; value: ReactNode; danger?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${danger ? "bg-destructive-subtle" : "bg-muted"}`}>
      <p className={`text-[11px] ${danger ? "text-destructive" : "text-muted-foreground"}`}>{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${danger ? "text-destructive" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function ListRow({
  active,
  onClick,
  avatar,
  title,
  mono,
  subtitle,
  trailing,
  originBadge,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  avatar: ReactNode;
  title: string;
  mono?: boolean;
  subtitle: ReactNode;
  trailing?: ReactNode;
  originBadge?: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-l-2 px-3 py-3 text-left transition-colors ${
        active ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50"
      }`}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold text-foreground ${mono ? "font-mono" : ""}`}>{title}</p>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {originBadge}
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {trailing}
      <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function Avatar({ children, alert }: { children: ReactNode; alert?: boolean }) {
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
        alert ? "bg-destructive-subtle text-destructive" : "bg-muted text-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function DetailHeader({
  avatar,
  title,
  mono,
  subtitle,
  onBack,
  actions,
}: {
  avatar: ReactNode;
  title: string;
  mono?: boolean;
  subtitle?: ReactNode;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3.5 md:px-6">
      <button
        type="button"
        onClick={onBack}
        aria-label="Kembali ke daftar"
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted lg:hidden"
      >
        <ArrowLeft size={18} />
      </button>
      {avatar}
      <div className="min-w-0 flex-1">
        <h2 className={`truncate text-base font-semibold text-foreground ${mono ? "font-mono" : ""}`}>{title}</h2>
        {subtitle && <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {actions}
    </div>
  );
}

const th = "whitespace-nowrap px-4 py-3 font-semibold md:px-6";
const td = "px-4 py-3.5 md:px-6";

/* ───────────────────────── Halaman ───────────────────────── */

export default function ProductMappingPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [tab, setTab] = useState<"mapping" | "varian" | "riwayat">("mapping");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [repoint, setRepoint] = useState<Record<string, string>>({});
  const [repointSaving, setRepointSaving] = useState<string | null>(null);
  const [adjustVariant, setAdjustVariant] = useState<Variant | null>(null);
  const [adjustForm, setAdjustForm] = useState({ newStock: "", note: "" });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [orphans, setOrphans] = useState<OrphanSku[]>([]);
  const [orphansLoaded, setOrphansLoaded] = useState(false);
  const [mapMode, setMapMode] = useState<Record<string, "existing" | "new">>({});
  const [mapTarget, setMapTarget] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState<Record<string, string>>({});
  const [mapSaving, setMapSaving] = useState<string | null>(null);
  const [stockInVariant, setStockInVariant] = useState<Variant | null>(null);
  const [stockInForm, setStockInForm] = useState({ qty: "", note: "" });
  const [stockInSaving, setStockInSaving] = useState(false);
  const [mapQuery, setMapQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [variantQuery, setVariantQuery] = useState("");
  const [listFilter, setListFilter] = useState<"all" | "linked" | "orphan">("all");
  const [selection, setSelection] = useState<Selection>(null);
  const [shown, setShown] = useState(PAGE_STEP);

  const loadAll = useCallback(async () => {
    const [m, v, storesRes] = await Promise.all([
      api<{ mappings: Mapping[] }>("/api/inventory/mappings"),
      api<{ variants: Variant[] }>("/api/inventory/variants"),
      api<Store[]>("/api/stores"),
    ]);
    setMappings(m.mappings ?? []);
    setVariants(v.variants ?? []);
    setStores(Array.isArray(storesRes) ? storesRes : []);
  }, []);

  const loadLedger = useCallback(async () => {
    const r = await api<{ entries: LedgerEntry[] }>("/api/inventory/ledger?limit=50");
    setLedger(r.entries ?? []);
  }, []);

  const loadOrphans = useCallback(async () => {
    const r = await api<{ orphans: OrphanSku[] }>("/api/inventory/orphan-skus");
    setOrphans(r.orphans ?? []);
    setOrphansLoaded(true);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadAll();
        const params = new URLSearchParams(window.location.search);
        if (params.get("accountId")) {
          setForm((previous) => ({ ...previous,
            accountId: params.get("accountId") ?? "", channelSku: params.get("channelSku") ?? "" }));
          setSelection({ kind: "new" });
        }
        await loadLedger();
        await loadOrphans();
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : "Gagal memuat data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAll, loadLedger, loadOrphans]);

  async function handleCreateMapping() {
    setError(null);
    if (!form.accountId || !form.channelSku.trim()) {
      setError("Pilih toko dan isi channel SKU.");
      return;
    }
    if (!form.useNewVariant && !form.variantId) {
      setError("Pilih varian target, atau aktifkan mode 'Varian baru'.");
      return;
    }
    setSaving(true);
    try {
      const result = await api<MappingResult>("/api/inventory/mappings", {
        method: "POST",
        body: JSON.stringify({
          accountId: form.accountId,
          channelSku: form.channelSku.trim(),
          variantId: form.useNewVariant ? undefined : form.variantId,
          newProductName: form.useNewVariant ? form.newProductName.trim() || undefined : undefined,
          sku: form.useNewVariant ? form.sku.trim() || undefined : undefined,
          stock: form.useNewVariant ? Number(form.stock) || 0 : undefined,
          safetyStock: form.useNewVariant ? Number(form.safetyStock) || 0 : undefined,
        }),
      });
      showStockWarnings(result);
      if (!result.reviewRequired) notify("success", "Produk toko berhasil dihubungkan ke stok pusat.");
      setForm(emptyForm);
      await loadAll();
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan mapping.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRepoint(id: string, variantId: string) {
    const target = variants.find((variant) => variant.id === variantId);
    const current = mappings.find((mapping) => mapping.id === id);
    if (!target || !current || current.variant?.id === variantId) return;
    if (!await confirmAction(`Hubungkan SKU marketplace ${current.channelSku} ke ${target.masterProduct.name} / ${target.sku}? Hubungan sebelumnya: ${current.variant?.sku ?? "belum terhubung"}. Stok fisik kedua varian tidak digabung.`)) return;
    setRepointSaving(id);
    setError(null);
    try {
      const result = await api<MappingResult>(`/api/inventory/mappings/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ variantId }),
      });
      showStockWarnings(result);
      notify("success", "Hubungan produk berhasil diperbarui.");
      setRepoint((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah variasi target.");
    } finally {
      setRepointSaving(null);
    }
  }

  async function handleDelete(id: string, channelSku: string) {
    if (!await confirmAction(`Hapus mapping SKU "${channelSku}"? Listing ini akan berdiri sendiri (tidak lagi gabung stok).`)) return;
    setError(null);
    try {
      await api(`/api/inventory/mappings/${id}`, { method: "DELETE" });
      setSelection(null);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus mapping.");
    }
  }

  async function handleMapOrphan(o: OrphanSku) {
    const key = orphanKey(o);
    const mode = mapMode[key] ?? "existing";
    setError(null);
    if (mode === "existing" && !mapTarget[key]) {
      setError("Pilih varian target dulu untuk SKU ini.");
      return;
    }
    if (mode === "new" && !newName[key]?.trim()) {
      setError("Isi nama produk master baru untuk SKU ini.");
      return;
    }
    setMapSaving(key);
    try {
      const result = await api<MappingResult>(`/api/inventory/orphan-skus/map`, {
        method: "POST",
        body: JSON.stringify(
          mode === "existing"
            ? { accountId: o.accountId, channelSku: o.channelSku, mode, variantId: mapTarget[key] }
            : { accountId: o.accountId, channelSku: o.channelSku, mode, newProductName: newName[key].trim(), platformTitle: o.sampleProductName ?? undefined }
        ),
      });
      showStockWarnings(result);
      setMapMode((p) => { const n = { ...p }; delete n[key]; return n; });
      setMapTarget((p) => { const n = { ...p }; delete n[key]; return n; });
      setNewName((p) => { const n = { ...p }; delete n[key]; return n; });
      await Promise.all([loadAll(), loadOrphans(), loadLedger()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mapping SKU.");
    } finally {
      setMapSaving(null);
    }
  }

  function openAdjust(v: Variant) {
    setAdjustVariant(v);
    setAdjustForm({ newStock: String(v.stock), note: "" });
  }

  async function handleStockIn() {
    if (!stockInVariant) return;
    const qty = Math.floor(Number(stockInForm.qty));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Isi jumlah barang masuk (bilangan bulat > 0).");
      return;
    }
    setStockInSaving(true);
    setError(null);
    try {
      await api("/api/inventory/stock-in", {
        method: "POST",
        body: JSON.stringify({
          variantId: stockInVariant.id,
          qty,
          note: stockInForm.note.trim() || undefined,
        }),
      });
      setStockInVariant(null);
      setStockInForm({ qty: "", note: "" });
      await loadAll();
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mencatat barang masuk.");
    } finally {
      setStockInSaving(false);
    }
  }

  async function handleAdjust() {
    if (!adjustVariant) return;
    const newStock = Math.floor(Number(adjustForm.newStock));
    if (!Number.isFinite(newStock) || newStock < 0) {
      setError("Isi stok baru yang valid (bilangan bulat >= 0).");
      return;
    }
    setAdjustSaving(true);
    setError(null);
    try {
      await api(`/api/inventory/variants/${adjustVariant.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({
          newStock,
          note: adjustForm.note.trim() || "Sesuaikan stok manual",
        }),
      });
      setAdjustVariant(null);
      setAdjustForm({ newStock: "", note: "" });
      await loadAll();
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyesuaikan stok.");
    } finally {
      setAdjustSaving(false);
    }
  }

  function changeTab(id: "mapping" | "varian" | "riwayat") {
    setTab(id);
    setSelection(null);
    setShown(PAGE_STEP);
    if (id === "riwayat") loadLedger().catch((e: unknown) => setError(e instanceof Error ? e.message : "Gagal memuat riwayat."));
  }

  /* ── Data turunan ── */
  const mq = mapQuery.trim().toLowerCase();
  const filteredMappings = mappings.filter((m) => (storeFilter === "all" || m.account?.id === storeFilter) && (!mq || [m.channelSku, m.account?.label, m.variant?.sku, m.variant?.masterProduct.name].some((x) => x?.toLowerCase().includes(mq))));
  const filteredOrphans = orphans.filter((o) => (storeFilter === "all" || o.accountId === storeFilter) && (!mq || [o.channelSku, o.accountLabel, o.sampleProductName].some((x) => x?.toLowerCase().includes(mq))));
  const vq = variantQuery.trim().toLowerCase();
  const filteredVariants = vq ? variants.filter((v) => [v.sku, v.masterProduct.name].some((x) => x.toLowerCase().includes(vq))) : variants;
  const totalEffective = variants.reduce((sum, v) => sum + effectiveStock(v), 0);
  const orphanAlert = orphansLoaded && orphans.length > 0;
  const visibleOrphans = listFilter === "linked" ? [] : filteredOrphans;
  const visibleMappings = filteredMappings.filter((mapping) => listFilter === "linked" ? !!mapping.variant : listFilter === "orphan" ? !mapping.variant : true);

  const selMapping = selection?.kind === "mapping" ? mappings.find((m) => m.id === selection.id) : undefined;
  const selOrphan = selection?.kind === "orphan" ? orphans.find((o) => orphanKey(o) === selection.key) : undefined;
  const selVariant = selection?.kind === "variant" ? variants.find((v) => v.id === selection.id) : undefined;
  const detailActive = selection?.kind === "new" || !!selMapping || !!selOrphan || !!selVariant;
  const back = () => setSelection(null);

  const kpis: Array<{ label: string; value: string; icon: LucideIcon; alert?: boolean }> = [
    { label: "Listing terhubung", value: loading ? "…" : mappings.filter((mapping) => mapping.variant).length.toLocaleString("id-ID"), icon: Link2 },
    { label: "Varian pusat", value: loading ? "…" : variants.length.toLocaleString("id-ID"), icon: Boxes },
    { label: "SKU belum terhubung", value: orphansLoaded ? orphans.length.toLocaleString("id-ID") : "…", icon: AlertTriangle, alert: orphanAlert },
    { label: "Tersedia di pusat", value: loading ? "…" : totalEffective.toLocaleString("id-ID"), icon: PackagePlus },
  ];

  const tabs = [
    { id: "mapping", label: "Produk Toko", count: mappings.length },
    { id: "varian", label: "Varian Pusat", count: variants.length },
    { id: "riwayat", label: "Riwayat Stok", count: ledger.length },
  ] as const;

  /* ───────────────────────── Panel detail ───────────────────────── */

  function renderNewForm() {
    return (
      <>
        <DetailHeader
          avatar={<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Plus size={18} aria-hidden="true" /></span>}
          title="Hubungkan Produk (Tambah Mapping)"
          subtitle="Pilih toko dan kode produk di marketplace, lalu arahkan ke variasi stok pusat."
          onBack={back}
          actions={
            <Button size="sm" variant="ghost" onClick={back} aria-label="Tutup formulir" className="hidden lg:inline-flex">
              <X size={14} /> Tutup
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 md:p-6">
          <Field label="Toko">
            <select value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))} className={field}>
              <option value="">— pilih toko —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({formatPlatform(s.platform)})</option>
              ))}
            </select>
          </Field>
          <Field label="SKU Marketplace">
            <input
              type="text"
              value={form.channelSku}
              onChange={(e) => setForm((f) => ({ ...f, channelSku: e.target.value }))}
              placeholder="mis. TTS3-BLK-A"
              className={field}
            />
          </Field>
          <Field label="2. Pilih sumber stok pusat" className="md:col-span-2">
            <Segmented
              value={form.useNewVariant ? "new" : "existing"}
              onChange={(next) => setForm((f) => ({ ...f, useNewVariant: next === "new" }))}
              options={[
                { id: "existing", label: "Varian yang sudah ada" },
                { id: "new", label: "Varian baru" },
              ]}
            />
          </Field>

          {!form.useNewVariant ? (
            <Field label="Varian pusat tujuan" className="md:col-span-2">
              <VariantSearchSelect
                value={form.variantId}
                onChange={(id) => setForm((f) => ({ ...f, variantId: id }))}
                variants={variants}
                placeholder="Cari & pilih variasi pusat tujuan..."
              />
            </Field>
          ) : (
            <>
              <Field label="Nama Produk Baru">
                <input
                  type="text"
                  value={form.newProductName}
                  onChange={(e) => setForm((f) => ({ ...f, newProductName: e.target.value }))}
                  placeholder="mis. Kaos kaki polos hitam"
                  className={field}
                />
              </Field>
              <Field label="Kode Variasi (SKU)">
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  placeholder="pakai channel SKU bila kosong"
                  className={field}
                />
              </Field>
              <Field label="Stok Awal">
                <input type="number" min="0" value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))} className={field} />
              </Field>
              <Field label="Cadangan">
                <input type="number" min="0" value={form.safetyStock} onChange={(e) => setForm((f) => ({ ...f, safetyStock: e.target.value }))} className={field} />
              </Field>
            </>
          )}

          {!form.useNewVariant && form.variantId && <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm md:col-span-2"><p className="font-semibold">3. Tinjau hubungan</p><p className="mt-1 break-words">{stores.find((store) => store.id === form.accountId)?.name ?? "Pilih toko"} / {form.channelSku || "Isi SKU marketplace"} → {variants.find((variant) => variant.id === form.variantId)?.masterProduct.name} / {variants.find((variant) => variant.id === form.variantId)?.sku}</p><p className="mt-2 text-xs text-muted-foreground">Produk toko ini memakai stok varian pusat tersebut. Jumlah stok tidak digabung. Alokasi setiap toko diatur melalui Stok Varian.</p></div>}
          <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
            <Button variant="outline" onClick={() => setForm(emptyForm)} disabled={saving}>
              Kosongkan
            </Button>
            <Button onClick={handleCreateMapping} disabled={saving}>
              <Link2 size={16} /> {saving ? "Menyimpan..." : "Hubungkan produk"}
            </Button>
          </div>
        </div>
      </>
    );
  }

  function renderMappingDetail(m: Mapping) {
    const v = m.variant;
    return (
      <>
        <DetailHeader
          avatar={<Avatar>{(m.account?.label ?? "?").charAt(0).toUpperCase()}</Avatar>}
          title={m.channelSku}
          mono
          subtitle={
            <>
              <OriginBadge mapping={m} />
              <span>{m.account?.label ?? "-"}</span>
              {m.account?.platform && <PlatformChip platform={m.account.platform} />}
            </>
          }
          onBack={back}
          actions={
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Hapus mapping ${m.channelSku}`}
              className="text-destructive hover:text-destructive"
              onClick={() => handleDelete(m.id, m.channelSku)}
            >
              <Trash2 size={14} /> Hapus
            </Button>
          }
        />
        <div className="space-y-6 p-4 md:p-6">
          <Section title="Terhubung ke stok pusat" hint="Stok yang dijual di toko ini diambil dari variasi pusat berikut.">
            {v ? (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{v.masterProduct.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">varian {v.sku}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { setTab("varian"); setSelection({ kind: "variant", id: v.id }); }}>
                    Lihat variasi pusat <ChevronRight size={13} />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                <StatBox label="Fisik" value={v.stock} />
                  <StatBox label="Cadangan" value={v.safetyStock} />
                  <StatBox label="Tersedia" value={effectiveStock(v)} danger={effectiveStock(v) === 0} />
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive-subtle px-4 py-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                <p className="text-sm text-destructive">belum ter-mapping — pilih varian target di bawah.</p>
              </div>
            )}
          </Section>

          <Section title="Ganti varian target" hint="Arahkan kode produk toko ini ke variasi pusat lain.">
            {repoint[m.id] !== undefined ? (
              <div className="flex flex-wrap items-center gap-2">
                <VariantSearchSelect
                  value={repoint[m.id]}
                  onChange={(id) => setRepoint((p) => ({ ...p, [m.id]: id }))}
                  variants={variants}
                  className="w-full sm:max-w-[360px]"
                  placeholder="Pilih variasi pusat..."
                />
                {variants.find((variant) => variant.id === repoint[m.id]) && <p className="basis-full rounded-lg bg-muted p-3 text-sm break-words">SKU toko <b>{m.channelSku}</b> → SKU pusat <b>{variants.find((variant) => variant.id === repoint[m.id])?.sku}</b>. Stok fisik tidak digabung.</p>}
                <Button onClick={() => handleRepoint(m.id, repoint[m.id])} disabled={!repoint[m.id] || repoint[m.id] === m.variant?.id || repointSaving === m.id}>
                  <Save size={14} /> {repointSaving === m.id ? "Menyimpan..." : "Simpan"}
                </Button>
                <Button variant="outline" onClick={() => setRepoint((p) => { const n = { ...p }; delete n[m.id]; return n; })}>
                  <X size={14} /> Batal
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setRepoint((p) => ({ ...p, [m.id]: "" }))}
                title="Ganti variasi pusat yang dihubungkan (Varian Target)"
              >
                Ganti Varian
              </Button>
            )}
          </Section>

          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Menghapus mapping membuat listing ini berdiri sendiri (tidak lagi gabung stok).
          </p>
        </div>
      </>
    );
  }

  function renderOrphanDetail(o: OrphanSku) {
    const key = orphanKey(o);
    const mode = mapMode[key] ?? "existing";
    return (
      <>
        <DetailHeader
          avatar={
            o.imageUrl ? (
              <img
                src={o.imageUrl}
                alt={o.sampleProductName || o.channelSku}
                className="size-10 shrink-0 rounded-md object-cover"
                loading="lazy"
                onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                  e.currentTarget.src = "/placeholder-product.svg";
                }}
              />
            ) : (
              <Avatar alert><AlertTriangle size={16} aria-hidden="true" /></Avatar>
            )
          }
          title={o.sampleProductName?.trim() || o.channelSku}
          mono={!o.sampleProductName?.trim()}
          subtitle={
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono text-xs">SKU/ID: {o.channelSku}</span>
              <span>·</span>
              <span>{o.accountLabel ?? "-"}</span>
              {o.platform && <PlatformChip platform={o.platform} />}
            </div>
          }
          onBack={back}
        />
        <div className="space-y-6 p-4 md:p-6">
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="Terjual di order" value={`${o.qty} pcs`} />
            <StatBox label="Jumlah order" value={o.orderCount} />
            <StatBox label="Terakhir muncul" value={<span className="text-sm">{o.lastSeenAt ? new Date(o.lastSeenAt).toLocaleDateString("id-ID", { dateStyle: "medium" }) : "-"}</span>} />
          </div>
          <div className="rounded-xl border border-border p-4 text-sm">
            <p className="text-xs text-muted-foreground">Nama listing di marketplace</p>
            <p className="mt-0.5 font-medium text-foreground">{o.sampleProductName ?? "(nama listing tidak tersedia)"}</p>
            {o.existingMappingId && (
              <p className="mt-2 text-xs text-muted-foreground">
                Hubungan sudah ada — gunakan Ganti Varian/aksi di bawah untuk melengkapi data pesanan lama (Backfill)
              </p>
            )}
          </div>

          <Section title="Hubungkan SKU ini" hint="Muncul di order tapi belum punya varian stok pusat. Analytics belum menampilkan nama produknya.">
            <Segmented
              value={mode}
              onChange={(next) => {
                setMapMode((p) => ({ ...p, [key]: next }));
                if (next === "new") setNewName((p) => ({ ...p, [key]: p[key] ?? o.sampleProductName ?? "" }));
              }}
              options={[
                { id: "existing", label: "Ke varian ada", icon: LinkIcon },
                { id: "new", label: "Buat master baru", icon: PackagePlus },
              ]}
            />
            {mode === "existing" ? (
              <div className="flex flex-wrap items-center gap-2">
                <VariantSearchSelect
                  value={mapTarget[key] ?? ""}
                  onChange={(id) => setMapTarget((p) => ({ ...p, [key]: id }))}
                  variants={variants}
                  className="w-full sm:max-w-[360px]"
                  placeholder="Ketik untuk cari variasi pusat..."
                />
                <Button onClick={() => handleMapOrphan(o)} disabled={mapSaving !== null || !mapTarget[key]}>
                  {mapSaving === key ? "Menyimpan..." : "Hubungkan & Lengkapi Pesanan Lama (Mapping + Backfill)"}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={newName[key] ?? ""}
                    onChange={(e) => setNewName((p) => ({ ...p, [key]: e.target.value }))}
                    placeholder="Nama produk master baru"
                    className={`${field} sm:max-w-[360px]`}
                  />
                  <Button onClick={() => handleMapOrphan(o)} disabled={mapSaving !== null || !newName[key]?.trim()}>
                    {mapSaving === key ? "Menyimpan..." : "Buat Produk Pusat & Hubungkan (Master + Mapping)"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Stok awal 0 — isi lewat “Sesuaikan Stok” setelah ini.</p>
              </div>
            )}
          </Section>
        </div>
      </>
    );
  }

  function renderVariantDetail(v: Variant) {
    const linked = mappings.filter((m) => m.variant?.id === v.id);
    const recent = ledger.filter((e) => e.variant?.sku === v.sku && e.variant?.masterProduct.name === v.masterProduct.name).slice(0, 5);
    return (
      <>
        <DetailHeader
          avatar={<Avatar><Boxes size={16} aria-hidden="true" /></Avatar>}
          title={v.masterProduct.name}
          subtitle={<span className="font-mono">{v.sku}</span>}
          onBack={back}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setAdjustVariant(null); setStockInVariant(v); setStockInForm({ qty: "", note: "" }); }}
                title="Catat barang masuk (restock fisik) — +qty, bukan angka absolut"
              >
                <PackagePlus size={14} /> Barang Masuk
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setStockInVariant(null); openAdjust(v); }}
                title="Set stok fisik hasil pengecekan"
              >
                <SlidersHorizontal size={14} /> Sesuaikan Stok
              </Button>
            </div>
          }
        />
        <div className="space-y-6 p-4 md:p-6">
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="Stok" value={v.stock} />
            <StatBox label="Stok Aman" value={v.safetyStock} />
            <StatBox label="Stok Efektif" value={effectiveStock(v)} danger={effectiveStock(v) === 0} />
          </div>

          {stockInVariant?.id === v.id && (
            <div className="rounded-xl border border-primary/40 bg-muted/40 p-4">
              <h3 className="text-sm font-semibold text-foreground">Barang Masuk: {v.masterProduct.name} / {v.sku}</h3>
              <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
                Stok sekarang {v.stock}. Isi JUMLAH MASUK (bukan stok total) — stok baru
                = stok sekarang + qty, tercatat di Riwayat Stok dengan alasan STOCK_IN.
              </p>
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[140px_1fr_auto]">
                <Field label="Jumlah Masuk">
                  <input type="number" min="1" value={stockInForm.qty} onChange={(e) => setStockInForm((f) => ({ ...f, qty: e.target.value }))} className={field} />
                </Field>
                <Field label="Catatan">
                  <input type="text" value={stockInForm.note} onChange={(e) => setStockInForm((f) => ({ ...f, note: e.target.value }))} placeholder="mis. PO-2026-091, terima 2 lusin" className={field} />
                </Field>
                <div className="flex items-center gap-2">
                  <Button onClick={handleStockIn} disabled={stockInSaving}>
                    <Save size={15} /> {stockInSaving ? "Menyimpan..." : "Catat"}
                  </Button>
                  <Button variant="outline" aria-label="Batal barang masuk" onClick={() => setStockInVariant(null)}>
                    <X size={15} />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {adjustVariant?.id === v.id && (
            <div className="rounded-xl border border-primary/40 bg-muted/40 p-4">
              <h3 className="text-sm font-semibold text-foreground">Sesuaikan Stok: {v.masterProduct.name} / {v.sku}</h3>
              <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
                Stok sekarang {v.stock} (efektif {effectiveStock(v)}). Isi
                angka stok fisik hasil pengecekan — selisih akan dicatat otomatis di Riwayat Stok.
              </p>
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[140px_1fr_auto]">
                <Field label="Stok Baru">
                  <input type="number" min="0" value={adjustForm.newStock} onChange={(e) => setAdjustForm((f) => ({ ...f, newStock: e.target.value }))} className={field} />
                </Field>
                <Field label="Catatan">
                  <input type="text" value={adjustForm.note} onChange={(e) => setAdjustForm((f) => ({ ...f, note: e.target.value }))} placeholder="mis. hasil stock opname gudang" className={field} />
                </Field>
                <div className="flex items-center gap-2">
                  <Button onClick={handleAdjust} disabled={adjustSaving}>
                    <Save size={15} /> {adjustSaving ? "Menyimpan..." : "Simpan"}
                  </Button>
                  <Button variant="outline" aria-label="Batal sesuaikan stok" onClick={() => setAdjustVariant(null)}>
                    <X size={15} />
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Section title={`Listing terhubung (${linked.length})`} hint="Toko yang berbagi stok dari variasi pusat ini.">
            {linked.length === 0 ? (
              <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">Belum ada listing toko yang terhubung ke variasi ini.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {linked.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => { setTab("mapping"); setSelection({ kind: "mapping", id: m.id }); }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <Avatar>{(m.account?.label ?? "?").charAt(0).toUpperCase()}</Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-mono text-sm font-medium text-foreground">{m.channelSku}</p>
                          <OriginBadge mapping={m} />
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{m.account?.label ?? "-"}</p>
                      </div>
                      {m.account?.platform && <PlatformChip platform={m.account.platform} />}
                      <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Mutasi terakhir" hint="Dari 50 riwayat stok terbaru.">
            {recent.length === 0 ? (
              <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">Belum ada mutasi untuk variasi ini.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {recent.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={`inline-flex min-w-10 justify-center rounded-md px-2 py-1 text-xs font-bold tabular-nums ${
                        e.changeQty < 0 ? "bg-destructive-subtle text-destructive" : "bg-success-subtle text-success"
                      }`}
                    >
                      {e.changeQty > 0 ? "+" : ""}{e.changeQty}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{e.reason ?? "-"}{e.note ? ` · ${e.note}` : ""}</p>
                      <p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString("id-ID")} · {e.user?.username ?? "-"}</p>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">→ {e.stockAfter}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </>
    );
  }

  function renderDetail() {
    if (selection?.kind === "new") return renderNewForm();
    if (selMapping) return renderMappingDetail(selMapping);
    if (selOrphan) return renderOrphanDetail(selOrphan);
    if (selVariant) return renderVariantDetail(selVariant);
    return (
      <EmptyState
        icon={MousePointerClick}
        action={
          tab === "mapping" ? (
            <Button onClick={() => setSelection({ kind: "new" })}>
              <Plus size={16} /> Tambah Mapping
            </Button>
          ) : undefined
        }
      >
        {tab === "mapping"
          ? "Pilih kode produk di daftar kiri untuk melihat rincian dan mengatur hubungannya, atau tambah mapping baru."
          : "Pilih variasi pusat di daftar kiri untuk melihat stok, listing terhubung, dan mencatat barang masuk."}
      </EmptyState>
    );
  }

  /* ───────────────────────── Render ───────────────────────── */

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">

      {/* ───────── Header ───────── */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Hubungkan Produk Toko</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Cara stok efektif dihitung" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm p-3 text-xs leading-relaxed">
                <strong>Tersedia di pusat = stok fisik − cadangan, minimal nol.</strong> Target stok setiap toko mengikuti pengaturan alokasi dan buffer di Stok Varian.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tentukan varian pusat yang menjadi sumber stok setiap produk marketplace. Mulai dari produk toko, lalu pilih SKU pusat yang sesuai.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => changeTab("riwayat")}>
            <History size={16} /> Riwayat Stok
          </Button>
          <Button
            variant="outline"
            onClick={() => { Promise.all([loadAll(), loadLedger(), loadOrphans()]).catch((e: unknown) => setError(e instanceof Error ? e.message : "Gagal memuat ulang.")); }}
          >
            <RefreshCw size={16} /> Muat Ulang
          </Button>
          <Button onClick={() => { setTab("mapping"); setSelection({ kind: "new" }); }}>
            <Plus size={16} /> Tambah Mapping
          </Button>
        </div>
      </header>

      <ol aria-label="Alur menghubungkan produk" className="grid gap-3 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-3">
        {["Pilih produk toko", "Pilih varian pusat", "Tinjau dan simpan"].map((step, index) => <li key={step} className="flex items-center gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</span><span className="font-medium">{step}</span></li>)}
      </ol>

      <details className="rounded-xl border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Bantuan pencocokan &amp; tinjauan SKU <span className="ml-1 font-normal text-muted-foreground">— buka bila ada produk yang sulit dicocokkan</span></summary>
        <div className="space-y-3 border-t border-border p-3"><SkuReviewPanel onShowUnlinked={() => { changeTab("mapping"); setListFilter("orphan"); setStoreFilter("all"); setMapQuery(""); window.requestAnimationFrame(() => document.getElementById("mapping-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} /><AutoMatchPanel /></div>
      </details>

      {error && !detailActive && <ErrorFeedback error={error} className="mb-4" />}

      {/* ───────── Strip ringkasan ───────── */}
      <section aria-label="Ringkasan mapping" className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:grid-cols-4 lg:divide-x lg:divide-border">
        {kpis.map(({ label, value, icon: Icon, alert }) => (
          <div key={label} className={`flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 lg:border-b-0 ${alert ? "bg-destructive-subtle" : ""}`}>
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${alert ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
              <Icon size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className={`truncate text-xs ${alert ? "font-medium text-destructive" : "text-muted-foreground"}`}>{label}</p>
              <p className={`text-lg font-bold leading-tight tabular-nums ${alert ? "text-destructive" : "text-foreground"}`}>{value}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ───────── Tab ───────── */}
      <div role="tablist" aria-label="Tampilan mapping stok" className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              data-testid={`mapping-tab-${t.id}`}
              onClick={() => changeTab(t.id)}
              className={`relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-4 text-sm font-medium transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {t.count}
                </span>
              )}
              {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-t-full bg-primary" />}
            </button>
          );
        })}
      </div>

      {/* ───────── Master-detail ───────── */}
      {tab !== "riwayat" && (
        <div id="mapping-workspace" className="grid scroll-mt-4 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          {/* Daftar (master) */}
          <section className={`${detailActive ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm`}>
            <div className="space-y-3 border-b border-border p-3">
              <p className="text-sm font-semibold">{tab === "mapping" ? "1. Pilih produk toko" : "Daftar varian pusat"}</p>
              {tab === "mapping" ? (
                <>
                  <SearchBox value={mapQuery} onChange={(v) => { setMapQuery(v); setShown(PAGE_STEP); }} placeholder="Cari toko, channel SKU, atau produk" />
                  <select aria-label="Filter toko" value={storeFilter} onChange={(event) => { setStoreFilter(event.target.value); setShown(PAGE_STEP); }} className={field}><option value="all">Semua toko</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {formatPlatform(store.platform)}</option>)}</select>
                  <Segmented
                    value={listFilter}
                    onChange={(next) => { setListFilter(next); setShown(PAGE_STEP); }}
                    options={[
                      { id: "all", label: "Semua" },
                      { id: "linked", label: `Terhubung (${filteredMappings.filter((mapping) => mapping.variant).length})` },
                      { id: "orphan", label: "Belum terhubung" },
                    ]}
                  />
                </>
              ) : (
                <SearchBox value={variantQuery} onChange={(v) => { setVariantQuery(v); setShown(PAGE_STEP); }} placeholder="Cari produk atau SKU" />
              )}
            </div>

            <div className="max-h-[70dvh] min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="space-y-3 p-3">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : tab === "mapping" ? (
                <>
                  {orphansLoaded && visibleOrphans.length > 0 && (
                    <div data-testid="orphan-panel">
                      <p className="sticky top-0 z-[1] flex items-center gap-2 bg-destructive-subtle px-3 py-2 text-xs font-semibold text-destructive">
                        <AlertTriangle size={13} aria-hidden="true" />
                        Kode Produk Pesanan Belum Terhubung (SKU) ({visibleOrphans.length})
                      </p>
                      <div className="divide-y divide-border">
                        {visibleOrphans.slice(0, shown).map((o) => {
                          const key = orphanKey(o);
                          const mainTitle = o.sampleProductName?.trim() || o.channelSku;
                          const isSkuOnly = !o.sampleProductName?.trim();
                          return (
                            <ListRow
                              key={`${o.accountId}|${o.channelSku}`}
                              testId={`orphan-row-${o.channelSku}`}
                              active={selection?.kind === "orphan" && selection.key === key}
                              onClick={() => setSelection({ kind: "orphan", key })}
                              avatar={
                                o.imageUrl ? (
                                  <img
                                    src={o.imageUrl}
                                    alt={mainTitle}
                                    className="size-9 shrink-0 rounded-md object-cover"
                                    loading="lazy"
                                    onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                                      e.currentTarget.src = "/placeholder-product.svg";
                                    }}
                                  />
                                ) : (
                                  <Avatar alert><AlertTriangle size={15} aria-hidden="true" /></Avatar>
                                )
                              }
                              title={mainTitle}
                              mono={isSkuOnly}
                              subtitle={
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className="font-mono text-[11px] text-muted-foreground">{o.channelSku}</span>
                                  <span>·</span>
                                  <span className="truncate">{o.accountLabel ?? "-"}</span>
                                </span>
                              }
                              trailing={<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">{o.qty} pcs</span>}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {visibleMappings.length > 0 && (
                    <div>
                      {visibleOrphans.length > 0 && (
                        <p className="sticky top-0 z-[1] bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                          Daftar Hubungan Produk (Mapping) ({visibleMappings.length})
                        </p>
                      )}
                      <div className="divide-y divide-border">
                        {visibleMappings.slice(0, shown).map((m) => (
                          <ListRow
                            key={m.id}
                            active={selection?.kind === "mapping" && selection.id === m.id}
                            onClick={() => setSelection({ kind: "mapping", id: m.id })}
                            avatar={<Avatar>{(m.account?.label ?? "?").charAt(0).toUpperCase()}</Avatar>}
                            title={m.variant?.masterProduct.name ?? m.channelSku}
                            subtitle={
                              m.variant
                                ? `${m.account?.label ?? "-"} · ${m.channelSku} → ${m.variant.sku}`
                                : `belum ter-mapping · ${m.account?.label ?? "-"}`
                            }
                            originBadge={<OriginBadge mapping={m} />}
                            trailing={m.variant ? <StockPill value={effectiveStock(m.variant)} /> : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {visibleMappings.length === 0 && visibleOrphans.length === 0 && (
                    <EmptyState icon={mq ? Search : Link2}>
                      {mq
                        ? `Tidak ada hasil untuk “${mapQuery}”.`
                        : "Belum ada hubungan produk (Mapping). Pilih toko dan variasi pusat melalui formulir Tambah Mapping."}
                    </EmptyState>
                  )}

                  {Math.max(visibleMappings.length, visibleOrphans.length) > shown && (
                    <div className="p-3">
                      <Button variant="outline" className="w-full" onClick={() => setShown((n) => n + PAGE_STEP)}>
                        Tampilkan {PAGE_STEP} lagi
                      </Button>
                    </div>
                  )}
                </>
              ) : filteredVariants.length === 0 ? (
                <EmptyState icon={vq ? Search : Boxes}>
                  {vq
                    ? `Tidak ada variasi yang cocok dengan “${variantQuery}”.`
                    : "Belum ada variasi stok pusat. Buat melalui Produk Master atau pilih mode variasi baru pada formulir Hubungkan Produk."}
                </EmptyState>
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {filteredVariants.slice(0, shown).map((v) => (
                      <ListRow
                        key={v.id}
                        active={selection?.kind === "variant" && selection.id === v.id}
                        onClick={() => setSelection({ kind: "variant", id: v.id })}
                        avatar={<Avatar><Boxes size={15} aria-hidden="true" /></Avatar>}
                        title={v.masterProduct.name}
                        subtitle={<span className="font-mono">{v.sku}</span>}
                        trailing={<StockPill value={effectiveStock(v)} />}
                      />
                    ))}
                  </div>
                  {filteredVariants.length > shown && (
                    <div className="p-3">
                      <Button variant="outline" className="w-full" onClick={() => setShown((n) => n + PAGE_STEP)}>
                        Tampilkan {PAGE_STEP} lagi
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Rincian (detail) — di layar kecil tampil sebagai layar penuh */}
          <div className={detailActive ? "min-w-0" : "hidden min-w-0 lg:block"}>
            <section className="min-w-0 rounded-xl border border-border bg-card shadow-sm">
              {error && <div role="alert" className="p-4"><ErrorFeedback error={error} /></div>}
              {renderDetail()}
            </section>
          </div>
        </div>
      )}

      {/* Riwayat Stok */}
      {tab === "riwayat" && (
        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-6">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <History size={16} aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Riwayat Perubahan Stok (stock_ledger)</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">50 mutasi terakhir</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadLedger().catch((e: unknown) => setError(e instanceof Error ? e.message : "Gagal memuat riwayat."))}
            >
              <RefreshCw size={14} /> Muat ulang
            </Button>
          </div>
          {ledger.length === 0 ? (
            <EmptyState icon={History}>Belum ada mutasi stok.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="bg-muted text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className={th}>Waktu</th>
                    <th className={th}>Produk / Varian</th>
                    <th className={`${th} text-right`}>Perubahan</th>
                    <th className={th}>Alasan</th>
                    <th className={`${th} text-right`}>Stok Setelah</th>
                    <th className={th}>Catatan</th>
                    <th className={th}>Oleh</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e) => (
                    <tr key={e.id} className="border-t border-border transition-colors hover:bg-muted/40">
                      <td className={`${td} whitespace-nowrap text-xs text-muted-foreground`}>{new Date(e.createdAt).toLocaleString("id-ID")}</td>
                      <td className={`${td} text-foreground`}>{e.variant ? `${e.variant.masterProduct.name} / ${e.variant.sku}` : "-"}</td>
                      <td className={`${td} text-right`}>
                        <span
                          className={`inline-flex min-w-10 justify-center rounded-md px-2 py-1 text-xs font-bold tabular-nums ${
                            e.changeQty < 0 ? "bg-destructive-subtle text-destructive" : "bg-success-subtle text-success"
                          }`}
                        >
                          {e.changeQty > 0 ? "+" : ""}{e.changeQty}
                        </span>
                      </td>
                      <td className={td}>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">{e.reason ?? "-"}</span>
                      </td>
                      <td className={`${td} text-right font-medium tabular-nums text-foreground`}>{e.stockAfter}</td>
                      <td className={`${td} text-xs text-muted-foreground`}>{e.note ?? "-"}</td>
                      <td className={`${td} text-xs text-muted-foreground`}>{e.user?.username ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
