"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Filter, RefreshCw, Search, Store } from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";

const PLATFORM: Record<string, string> = {
  TIKTOK_SHOP: "TikTok Shop",
  SHOPEE: "Shopee",
  TOKOPEDIA: "Tokopedia",
};

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PENDING_SELLER: { label: "Menunggu Respons", className: "bg-muted text-foreground" },
  APPROVED: { label: "Disetujui", className: "bg-muted text-foreground" },
  REJECTED: { label: "Ditolak", className: "bg-muted text-foreground" },
  PLATFORM_DECIDED: { label: "Diputuskan Platform", className: "bg-muted text-foreground" },
  IN_TRANSIT: { label: "Barang Dikirim Balik", className: "bg-muted text-foreground" },
  RECEIVED: { label: "Diterima Gudang", className: "bg-muted text-foreground" },
  REFUNDED: { label: "Selesai Refund", className: "bg-muted text-foreground" },
  DISPUTED: { label: "Sengketa", className: "bg-muted text-foreground" },
  CANCELLED: { label: "Dibatalkan", className: "bg-muted text-foreground" },
  UNKNOWN: { label: "Status Baru", className: "bg-muted text-foreground" },
};

const TABS: { id: string; label: string }[] = [
  { id: "all", label: "Semua Retur" },
  { id: "pending", label: "Perlu Respons" },
  { id: "warehouse", label: "Menunggu Konfirmasi Gudang" },
  { id: "done", label: "Selesai / Ditolak" },
];

const TAB_STATUSES: Record<string, string[] | null> = {
  all: null,
  pending: ["PENDING_SELLER", "PLATFORM_DECIDED"],
  warehouse: null,
  done: ["REFUNDED", "REJECTED", "CANCELLED", "DISPUTED"],
};

type ReturnItemRow = {
  id: string;
  channelSku: string;
  externalSkuId: string | null;
  productName: string | null;
  skuName: string | null;
  qty: number;
  price: number | null;
  variantId: string | null;
  restockedAt: string | null;
  variant?: { sku: string; name: string | null; masterProduct: { name: string } | null } | null;
};

type ReturnRow = {
  id: string;
  externalReturnId: string;
  externalOrderId: string | null;
  status: string;
  rawStatus: string;
  type: string | null;
  requestType: string | null;
  reason: string | null;
  reasonText: string | null;
  refundAmount: number | null;
  currency: string | null;
  buyerEvidence: string | null;
  isPlatformAutoApproved: boolean;
  slaDueDate: string | null;
  firstSeenAt: string;
  lastSyncedAt: string | null;
  account: { id: string; platform: string; label: string };
  items: ReturnItemRow[];
};

function formatPrice(value: number | null | undefined) {
  return value == null ? "-" : `Rp ${value.toLocaleString("id-ID")}`;
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-";
}

function slaBadge(slaDueDate: string | null) {
  if (!slaDueDate) return null;
  const diffMs = new Date(slaDueDate).getTime() - Date.now();
  const hours = diffMs / 3600000;
  if (diffMs < 0) {
    return { label: "SLA terlewat", className: "bg-primary text-primary-foreground" };
  }
  if (hours <= 24) {
    return { label: `Sisa ${Math.max(1, Math.ceil(hours))} jam`, className: "bg-muted-foreground text-primary-foreground" };
  }
  return null;
}

function evidenceImages(returnRow: ReturnRow): string[] {
  if (!returnRow.buyerEvidence) return [];
  try {
    const parsed = JSON.parse(returnRow.buyerEvidence) as { images?: string[] } | string[];
    if (Array.isArray(parsed)) return parsed;
    return parsed.images ?? [];
  } catch {
    return [];
  }
}

export default function ReturnsPage() {
  const [tab, setTab] = useState("all");
  const [platform, setPlatform] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReturnRow | null>(null);
  const [restockingId, setRestockingId] = useState<string | null>(null);

  const fetchParams = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    const statuses = TAB_STATUSES[tab];
    if (tab === "warehouse") params.set("tab", "warehouse");
    else if (statuses) params.set("status", statuses.join(","));
    if (platform) params.set("platform", platform);
    if (q) params.set("q", q);
    return params.toString();
  }, [tab, platform, q, page]);

  const load = useCallback(async () => {
    const res = await authFetch(`/api/returns?${fetchParams()}`);
    const data = (await res.json()) as { returns?: ReturnRow[]; total?: number };
    setRows(data.returns ?? []);
    setTotal(data.total ?? 0);
  }, [fetchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/returns?${fetchParams()}`);
        const data = (await res.json()) as { returns?: ReturnRow[]; total?: number };
        if (cancelled) return;
        setRows(data.returns ?? []);
        setTotal(data.total ?? 0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchParams]);

  const sync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await authFetch("/api/returns/sync", { method: "POST" });
      const data = (await res.json()) as { results?: Array<Record<string, unknown>>; errors?: string[] };
      if (data.errors?.length) {
        setSyncMessage(`Sinkron selesai dengan ${data.errors.length} error: ${data.errors[0]}`);
      } else {
        setSyncMessage("Sinkronisasi retur selesai.");
      }
      await load();
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : "Gagal sinkronisasi.");
    } finally {
      setSyncing(false);
    }
  };

  const restock = async (itemId: string) => {
    setRestockingId(itemId);
    try {
      const res = await authFetch("/api/returns/restock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? "Gagal menambah stok.");
      }
      if (detail) {
        const item = detail.items.find((it) => it.id === itemId);
        if (item) item.restockedAt = new Date().toISOString();
        setDetail({ ...detail });
      }
      await load();
    } finally {
      setRestockingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Kelola Pengembalian</h1>
          <p className="text-sm text-muted-foreground">
            Retur & refund Shopee dan TikTok Shop. Approve/reject dilakukan di Seller Center masing-masing
            (aksi API menyusul setelah scope aktif).
          </p>
        </div>
        <button
          onClick={sync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Menyinkronkan..." : "Sinkron Retur"}
        </button>
      </div>

      {syncMessage && (
        <div className="mb-4 rounded-lg bg-muted px-4 py-2 text-sm text-foreground">{syncMessage}</div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setPage(1); }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === t.id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Cari no. retur / order / SKU..."
            className="w-72 rounded-lg border border-border py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="relative">
          <Store className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <select
            value={platform}
            onChange={(e) => { setPlatform(e.target.value); setPage(1); }}
            className="rounded-lg border border-border py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          >
            <option value="">Semua Platform</option>
            <option value="TIKTOK_SHOP">TikTok Shop</option>
            <option value="SHOPEE">Shopee</option>
          </select>
        </div>
        <Filter className="ml-auto h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{total} retur</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Retur</th>
              <th className="px-4 py-3">Toko</th>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Refund</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Tanda</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Memuat...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Belum ada data retur. Tekan &quot;Sinkron Retur&quot; untuk menarik dari platform.</td></tr>
            )}
            {rows.map((r) => {
              const badge = STATUS_LABEL[r.status] ?? STATUS_LABEL.UNKNOWN;
              const sla = slaBadge(r.slaDueDate);
              const first = r.items[0];
              return (
                <tr key={r.id} className="hover:bg-muted">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.externalReturnId}</div>
                    <div className="text-xs text-muted-foreground">Order {r.externalOrderId ?? "-"}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(r.firstSeenAt)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{r.account.label}</div>
                    <div className="text-xs text-muted-foreground">{PLATFORM[r.account.platform] ?? r.account.platform}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="max-w-52 truncate text-foreground">
                      {first?.variant?.masterProduct?.name ?? first?.productName ?? "-"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {first ? `${first.channelSku} × ${first.qty}` : "-"}
                      {r.items.length > 1 ? ` +${r.items.length - 1} lainnya` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">{formatPrice(r.refundAmount)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    <div className="mt-1 text-xs text-muted-foreground">{r.rawStatus}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {r.isPlatformAutoApproved && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          <CheckCircle2 className="h-3 w-3" /> Platform-approved
                        </span>
                      )}
                      {sla && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${sla.className}`}>
                          <AlertTriangle className="h-3 w-3" /> {sla.label}
                        </span>
                      )}
                      {r.items.some((it) => !it.variantId) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                          SKU belum ter-mapping
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDetail(r)} className="text-sm font-medium text-foreground hover:underline">
                      Detail
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
          >
            Sebelumnya
          </button>
          <span className="text-muted-foreground">Halaman {page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
          >
            Berikutnya
          </button>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4" onClick={() => setDetail(null)}>
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">Retur {detail.externalReturnId}</h2>
                <p className="text-sm text-muted-foreground">
                  {detail.account.label} · {PLATFORM[detail.account.platform] ?? detail.account.platform} · Order {detail.externalOrderId ?? "-"}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground">Status</div>
                <div className="font-medium">{(STATUS_LABEL[detail.status] ?? STATUS_LABEL.UNKNOWN).label}</div>
                <div className="text-xs text-muted-foreground">raw: {detail.rawStatus}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Tipe</div>
                <div className="font-medium">
                  {detail.type === "REFUND_ONLY" ? "Refund Only" : detail.type === "RETURN_REFUND" ? "Retur & Refund" : "-"}
                  {detail.requestType ? ` · ${detail.requestType}` : ""}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Alasan</div>
                <div className="font-medium">{detail.reason ?? "-"}</div>
                <div className="text-xs text-muted-foreground">{detail.reasonText ?? ""}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Jumlah Refund</div>
                <div className="font-medium">{formatPrice(detail.refundAmount)} {detail.currency ?? ""}</div>
              </div>
              <div>
                <div className="text-muted-foreground">SLA Respons</div>
                <div className="inline-flex items-center gap-1 font-medium">
                  <Clock className="h-4 w-4 text-muted-foreground" /> {formatDate(detail.slaDueDate)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Terakhir Sinkron</div>
                <div className="font-medium">{formatDate(detail.lastSyncedAt)}</div>
              </div>
            </div>

            {evidenceImages(detail).length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-sm font-medium text-foreground">Bukti dari Pembeli</div>
                <div className="flex flex-wrap gap-2">
                  {evidenceImages(detail).map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="bukti retur" className="h-20 w-20 rounded-lg object-cover" />
                  ))}
                </div>
              </div>
            )}

            <div className="mb-2 text-sm font-medium text-foreground">Item Retur</div>
            <div className="divide-y divide-border rounded-xl border border-border">
              {detail.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {it.variant?.masterProduct?.name ?? it.productName ?? "-"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {it.variant ? `${it.variant.sku} · varian ter-mapping` : `${it.channelSku} · SKU belum ter-mapping`} × {it.qty}
                    </div>
                  </div>
                  {it.restockedAt ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Stok ditambah {formatDate(it.restockedAt)}
                    </span>
                  ) : it.variantId ? (
                    <button
                      onClick={() => restock(it.id)}
                      disabled={restockingId === it.id}
                      className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary disabled:opacity-50"
                    >
                      {restockingId === it.id ? "Memproses..." : "Terima & Tambah Stok"}
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">Petakan SKU dulu di halaman Mapping</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
