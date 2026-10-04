"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Mail, ChevronDown, Search, Filter, Calendar, RefreshCw, Printer, Info, X } from "lucide-react";
import OrderCard, { type PrintType } from "./OrderCard";
import PrintDropdown from "./PrintDropdown";
import { printOrders, printShippingDocument, printPdfWindow, pdfBlobFromBase64, type PrintableOrder } from "./printOrders";
import { ordersToCsv, downloadCsv, type ExportOrderRow } from "./exportOrders";
import RequestPickupModal, { type PickupShipResult, type RequestPickupOrder } from "./RequestPickupModal";
import ShopeeShipModal from "./ShopeeShipModal";
import PickupSuccessModal from "./PickupSuccessModal";
import PrintMethodModal from "./PrintMethodModal";
import { PackageCheck } from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";
import { PageHeader } from "@/components/ui/page-header";
import { DataCard } from "@/components/ui/data-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

const PAGE_SIZE = 20;

const TABS: { id: string; label: string; statuses: string[] | null }[] = [
  { id: "all", label: "Semua Pesanan", statuses: null },
  { id: "unpaid", label: "Belum Dibayar", statuses: ["UNPAID"] },
  // ON_HOLD = pembayaran masuk & sedang dicek; belum wajib kirim.
  { id: "new", label: "Pesanan Baru", statuses: ["ON_HOLD"] },
  { id: "ready", label: "Siap Dikirim", statuses: ["AWAITING_SHIPMENT"] },
  {
    id: "shipped",
    label: "Dikirim",
    statuses: ["PARTIALLY_SHIPPING", "AWAITING_COLLECTION", "IN_TRANSIT"],
  },
  { id: "completed", label: "Selesai", statuses: ["DELIVERED", "COMPLETED"] },
  { id: "cancelled", label: "Pembatalan", statuses: ["CANCELLED"] },
  // TikTok tidak menyediakan status order untuk return (return = entitas RMA terpisah).
  { id: "returned", label: "Pengembalian", statuses: [] },
];

// Sub-tab untuk tab yang memiliki sub-kategori status
type SubTab = { id: string; label: string; statuses: string[] };
const SUB_TABS: Record<string, SubTab[]> = {
  ready: [
    { id: "all", label: "Semua", statuses: ["AWAITING_SHIPMENT"] },
    { id: "need_process", label: "Perlu Diproses", statuses: ["AWAITING_SHIPMENT"] },
    { id: "processing", label: "Diproses", statuses: ["AWAITING_SHIPMENT"] },
    { id: "processed", label: "Telah Diproses", statuses: ["AWAITING_SHIPMENT"] },
  ],
  shipped: [
    { id: "all", label: "Semua", statuses: ["PARTIALLY_SHIPPING", "AWAITING_COLLECTION", "IN_TRANSIT"] },
    { id: "in_transit", label: "Dalam Pengiriman", statuses: ["IN_TRANSIT", "PARTIALLY_SHIPPING"] },
    { id: "delivered", label: "Telah Dikirim", statuses: ["AWAITING_COLLECTION"] },
    { id: "failed", label: "Pengiriman Gagal", statuses: [] },
  ],
};

const SORT_OPTIONS: { id: string; label: string; field: "createTime" | "amount"; dir: "desc" | "asc" }[] = [
  { id: "status_new", label: "Status Pesanan Terbaru", field: "createTime", dir: "desc" },
  { id: "status_old", label: "Status Pesanan Terlama", field: "createTime", dir: "asc" },
  { id: "newest", label: "Tanggal Pesanan Terbaru hingga Terlama", field: "createTime", dir: "desc" },
  { id: "oldest", label: "Tanggal Pesanan Terlama hingga Terbaru", field: "createTime", dir: "asc" },
  { id: "courier_az", label: "Kurir: A-Z", field: "amount", dir: "asc" },
  { id: "courier_za", label: "Kurir: Z-A", field: "amount", dir: "desc" },
  { id: "deadline_new", label: "Batas Waktu Pengiriman Terbaru hingga Terlama", field: "amount", dir: "desc" },
  { id: "deadline_old", label: "Batas Waktu Pengiriman Terlama hingga Terbaru", field: "amount", dir: "asc" },
];

type OrderItem = {
  id: string;
  channelSku: string;
  productId: string | null;
  imageUrl: string | null;
  qty: number;
  price: number | null;
  variant?: {
    sku: string;
    masterProduct: { name: string } | null;
  } | null;
};

type Order = {
  id: string;
  orderNo: string;
  status: string;
  buyerName: string | null;
  buyerEmail: string | null;
  amount: number | null;
  currency: string | null;
  createTime: string | null;
  shippingDueTime: string | null;
  account: { id: string; platform: string; label: string } | null;
  items: OrderItem[];
  orderMappings: { externalOrderId: string; rawStatus: string }[];
  shipments: { externalId: string | null; carrier: string | null; trackingNo: string | null; status: string }[];
};

type OrderDetail = {
  orderNo: string;
  storeName: string;
  platform: string | null;
  orderDate: string | null;
  buyerNote: string | null;
  paymentMethodName: string | null;
  currency: string | null;
  amount: number | null;
  canViewFullPii: boolean;
  buyer: { name: string; phone: string; address: string };
  shipments: { carrier: string | null; trackingNo: string | null; status: string }[];
  items: {
    productName: string;
    variantLabel: string;
    category: string | null;
    qty: number;
    price: number | null;
    subTotal: number | null;
  }[];
};

const PLATFORM: Record<string, string> = {
  TIKTOK_SHOP: "TikTok Shop",
  SHOPEE: "Shopee",
  TOKOPEDIA: "Tokopedia",
};

/**
 * labelMenuDescription — deskripsi menu "Cetak Label" (bulk) mengikuti seleksi:
 * campuran → label resmi TikTok + label lokal; murni TikTok → label resmi;
 * murni non-TikTok → label lokal (M8c, tanpa panggilan TikTok API).
 */
function labelMenuDescription(orders: Order[], selected: Set<string>): string {
  const sel = orders.filter((o) => selected.has(o.id));
  const hasTikTok = sel.some((o) => o.account?.platform === "TIKTOK_SHOP");
  const hasLocal = sel.some((o) => o.account?.platform !== "TIKTOK_SHOP");
  if (hasTikTok && hasLocal) return "Label resmi TikTok (PDF) + label lokal utk non-TikTok";
  if (hasTikTok) return "Label resmi TikTok gabungan (PDF)";
  return "Label pengiriman lokal (alamat & resi)";
}

function formatPrice(value: number | null | undefined, fallback = "-") {
  return value == null ? fallback : `Rp ${value.toLocaleString("id-ID")}`;
}

function toCardOrder(o: Order) {
  const totalQty = o.items.reduce((acc, it) => acc + it.qty, 0);
  const first = o.items[0];
  const productName = first?.variant?.masterProduct?.name ?? first?.productId ?? "-";
  const productVariant = first?.variant?.sku ?? `SKU ${first?.channelSku ?? "-"}`;
  const price = formatPrice(first?.price, "");
  const orderDate = o.createTime
    ? new Date(o.createTime).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
    : "-";
  const storeName = o.account?.label ?? "-";
  const platform = PLATFORM[o.account?.platform ?? ""] ?? o.account?.platform ?? "-";
  const shipment = o.shipments?.[0] ?? null;

  return {
    id: o.id,
    status: o.status,
    orderId: o.orderNo,
    deadline: orderDate,
    storeName,
    platform,
    productName,
    productVariant,
    productImage: first?.imageUrl ?? null,
    qty: totalQty,
    price,
    totalPrice: formatPrice(o.amount),
    paymentMethod: o.currency ?? "IDR",
    buyerName: o.buyerName ?? "-",
    buyerPhone: "",
    address: "",
    orderDate,
    sellerNote: null,
    courier: shipment?.carrier ?? "-",
    trackingNumber: shipment?.trackingNo ?? "-",
    buyerNote: null,
    pickupLocation: "Master Warehouse",
    fulfillmentStage: null,
    shippingDueTime: o.shippingDueTime,
    items: o.items.map((it) => ({
      name: it.variant?.masterProduct?.name ?? it.productId ?? "-",
      variant: it.variant?.sku ?? `SKU ${it.channelSku}`,
      qty: it.qty,
      price: formatPrice(it.price, "Rp 0"),
    })),
  };
}

function toPrintable(o: Order): PrintableOrder {
  return {
    id: o.id,
    orderNo: o.orderNo,
    storeName: o.account?.label ?? "-",
    platform: PLATFORM[o.account?.platform ?? ""] ?? o.account?.platform ?? "-",
    buyerName: o.buyerName ?? "-",
    buyerPhone: "-",
    address: "-",
    totalPrice: formatPrice(o.amount),
    paymentMethod: o.currency ?? "IDR",
    orderDate: o.createTime
      ? new Date(o.createTime).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
      : "-",
    items: o.items.map((it) => ({
      name: it.variant?.masterProduct?.name ?? it.productId ?? "-",
      variant: it.variant?.sku ?? `SKU ${it.channelSku}`,
      qty: it.qty,
      price: formatPrice(it.price, "Rp 0"),
    })),
  };
}

async function fetchOrderDetail(id: string): Promise<OrderDetail | null> {
  try {
    const token = localStorage.getItem("token");
    const res = await authFetch(`/api/orders/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * fetchOfficialLabel — minta label RESMI TikTok (GetPackageShippingDocument).
 * Hanya ada untuk paket TikTok Shipping yang sudah di-ship; selain itu null.
 */
async function fetchOfficialLabel(
  id: string
): Promise<{ docUrl: string; pdfBase64?: string; trackingNumber: string | null } | null> {
  try {
    const token = localStorage.getItem("token");
    const res = await authFetch(`/api/orders/${id}/label`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.docUrl
      ? {
          docUrl: data.docUrl,
          pdfBase64: data.pdfBase64 ?? undefined,
          trackingNumber: data.trackingNumber ?? null,
        }
      : null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

function toPrintableFromDetail(o: OrderDetail): PrintableOrder {
  const shipment = o.shipments[0];
  return {
    id: "",
    orderNo: o.orderNo,
    storeName: o.storeName,
    platform: PLATFORM[o.platform ?? ""] ?? o.platform ?? "-",
    buyerName: o.buyer.name,
    buyerPhone: o.buyer.phone,
    address: o.buyer.address,
    totalPrice: formatPrice(o.amount),
    paymentMethod: o.paymentMethodName ?? o.currency ?? "IDR",
    orderDate: o.orderDate
      ? new Date(o.orderDate).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
      : "-",
    courier: shipment?.carrier ?? undefined,
    trackingNumber: shipment?.trackingNo ?? undefined,
    sellerNote: o.buyerNote,
    items: o.items.map((it) => ({
      name: it.productName,
      variant: it.variantLabel,
      category: it.category ?? undefined,
      qty: it.qty,
      price: it.price != null ? formatPrice(it.price, "Rp 0") : "Rp 0",
    })),
  };
}

function toExportRow(o: Order): ExportOrderRow {
  return {
    orderNo: o.orderNo,
    status: o.status,
    store: o.account?.label ?? "-",
    platform: PLATFORM[o.account?.platform ?? ""] ?? o.account?.platform ?? "-",
    buyerName: o.buyerName ?? "-",
    buyerEmail: o.buyerEmail ?? "-",
    amount: formatPrice(o.amount),
    currency: o.currency ?? "-",
    createTime: o.createTime
      ? new Date(o.createTime).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
      : "-",
    qty: o.items.reduce((acc, it) => acc + it.qty, 0),
    products: o.items
      .map((it) => it.variant?.masterProduct?.name ?? it.productId ?? it.channelSku)
      .join("; "),
  };
}

/** Mapping Order → data modal "Atur Pengiriman" (dipakai alur TikTok & Shopee). */
function toPickupOrder(o: Order): RequestPickupOrder {
  return {
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    platform: PLATFORM[o.account?.platform ?? ""] ?? o.account?.platform ?? "-",
    storeName: o.account?.label ?? "-",
    totalQty: o.items.reduce((acc, it) => acc + it.qty, 0),
    totalPrice: formatPrice(o.amount),
    buyerName: o.buyerName ?? "-",
    courier: o.shipments?.[0]?.carrier ?? "-",
    paymentMethod: o.currency ?? "IDR",
  };
}

function buildQueryParams(input: {
  page: number;
  tab: { id: string; statuses: string[] | null };
  q: string;
  searchType: string;
  sort: (typeof SORT_OPTIONS)[number];
  from: string;
  to: string;
}) {
  const params = new URLSearchParams();
  params.set("page", String(input.page));
  params.set("pageSize", String(PAGE_SIZE));
  const statuses = input.tab.statuses;
  if (statuses !== null) params.set("status", statuses.join(","));
  if (input.q.trim()) {
    params.set("q", input.q.trim());
    params.set("searchType", input.searchType);
  }
  params.set("sort", input.sort.field);
  params.set("dir", input.sort.dir);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  return params.toString();
}

const SEARCH_TYPES = [
  { id: "keyword", label: "Keyword Pesanan", placeholder: "Cari nomor pesanan, produk, pembeli, resi" },
  { id: "orderNo", label: "No. Pesanan", placeholder: "Cari nomor pesanan" },
  { id: "product", label: "Produk Master", placeholder: "Cari nama produk" },
  { id: "tracking", label: "Nomor Resi", placeholder: "Cari nomor resi" },
];

export default function OrdersPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("all");
  const [activeSubTab, setActiveSubTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [searchType, setSearchType] = useState(SEARCH_TYPES[0]);
  const [searchTypeOpen, setSearchTypeOpen] = useState(false);
  const searchTypeRef = useRef<HTMLDivElement>(null);

  // Close search-type dropdown when clicking outside
  useEffect(() => {
    if (!searchTypeOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchTypeRef.current && !searchTypeRef.current.contains(e.target as Node)) {
        setSearchTypeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchTypeOpen]);
  const [sort, setSort] = useState(SORT_OPTIONS[0]);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // Close sort dropdown when clicking outside
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Background run (SyncRun): progres live + tombol terkunci saat aktif. */
  const [bgActive, setBgActive] = useState(false);
  const [bgProgress, setBgProgress] = useState<{ fetched: number; created: number; skipped: number; phase: string | null } | null>(null);
  const [infoDismissed, setInfoDismissed] = useState(false);
  const bgWasActive = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printingBulk, setPrintingBulk] = useState(false);
  const [pickupTargets, setPickupTargets] = useState<RequestPickupOrder[] | null>(null);
  const [shopeeTargets, setShopeeTargets] = useState<RequestPickupOrder[] | null>(null);
  const [pickupResult, setPickupResult] = useState<PickupShipResult | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printOrderIds, setPrintOrderIds] = useState<string[]>([]);

  const currentTab = TABS.find((t) => t.id === activeTab) ?? TABS[0];
  const currentSubTabs = SUB_TABS[activeTab] ?? null;
  const currentSubTab = currentSubTabs?.find((s) => s.id === activeSubTab) ?? currentSubTabs?.[0] ?? null;

  const fetchOrders = useCallback(
    async (opts: { page: number; tab: typeof currentTab; subTab: typeof currentSubTab; q: string; searchType: string; sort: typeof sort; from: string; to: string }) => {
      const token = localStorage.getItem("token");
      // Gunakan statuses dari sub-tab jika ada & bukan tab 'all'; jika sub-tab memiliki statuses kosong, kembalikan kosong
      const effectiveTab = opts.subTab && opts.subTab.id !== "all"
        ? { id: opts.tab.id, label: opts.tab.label, statuses: opts.subTab.statuses }
        : opts.tab;
      const query = buildQueryParams({ ...opts, tab: effectiveTab });
      const res = await authFetch(`/api/orders?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Terjadi kesalahan saat memuat pesanan (${res.status})`);
      const data = await res.json();
      return data;
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchOrders({ page, tab: currentTab, subTab: currentSubTab, q, searchType: searchType.id, sort, from, to });
        if (cancelled) return;
        setOrders(data.orders ?? []);
        setTotal(data.total ?? 0);
        setPageCount(data.pageCount ?? 1);
        setCounts(data.counts ?? {});
        setSelected(new Set());
      } catch (e) {
        console.error(e);
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Terjadi kesalahan saat memuat pesanan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, currentTab, currentSubTab, q, searchType.id, sort, from, to, fetchOrders]);

  const handleTab = (id: string) => {
    setActiveTab(id);
    setActiveSubTab("all");
    setPage(1);
  };

  const handleSubTab = (id: string) => {
    setActiveSubTab(id);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
  };

  // Debounce: tunggu jeda pengetikan sebelum query dicommit & fetch dijalankan.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleSortChange = (opt: (typeof SORT_OPTIONS)[number]) => {
    setSort(opt);
    setSortOpen(false);
    setPage(1);
  };

  const handleDateChange = (key: "from" | "to", value: string) => {
    if (key === "from") setFrom(value);
    else setTo(value);
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearchInput("");
    setQ("");
    setFrom("");
    setTo("");
    setSort(SORT_OPTIONS[0]);
    setPage(1);
  };

  const hasActiveFilters = q.trim() !== "" || from !== "" || to !== "" || sort.id !== "newest";

  const refreshList = async () => {
    try {
      const refreshed = await fetchOrders({ page, tab: currentTab, subTab: currentSubTab, q, searchType: searchType.id, sort, from, to });
      setOrders(refreshed.orders ?? []);
      setTotal(refreshed.total ?? total);
      setPageCount(refreshed.pageCount ?? pageCount);
      setCounts(refreshed.counts ?? counts);
      setSelected(new Set());
    } catch {
      // Refresh gagal bukan hal fatal — info sudah tampil di modal.
    }
  };

  /** Poll status background run (SyncRun): progres live + alert penutup. */
  const refreshRunStatus = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/orders/sync/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        runs: Array<{
          id: string;
          status: string;
          phase: string | null;
          message: string | null;
          fetched: number;
          created: number;
          skipped: number;
          error: string | null;
        }>;
      };
      const runs = data.runs ?? [];
      const activeRuns = runs.filter((r) => r.status === "QUEUED" || r.status === "RUNNING");
      if (activeRuns.length > 0) {
        bgWasActive.current = true;
        setBgActive(true);
        setBgProgress({
          fetched: activeRuns.reduce((a, r) => a + r.fetched, 0),
          created: activeRuns.reduce((a, r) => a + r.created, 0),
          skipped: activeRuns.reduce((a, r) => a + r.skipped, 0),
          phase: activeRuns.find((r) => r.phase === "rate_wait")?.phase ?? activeRuns[0]?.phase ?? null,
        });
        return;
      }
      setBgActive(false);
      setBgProgress(null);
      if (bgWasActive.current) {
        bgWasActive.current = false;
        const last = runs[0];
        if (last?.status === "DONE") {
          alert(`Sync selesai — ${last.created} order baru, ${last.skipped} sudah ada (${last.fetched} ditarik).`);
        } else if (last?.status === "FAILED") {
          alert(`Sync gagal: ${last.error ?? "-"}\n\nKlik "Sync Pesanan" untuk lanjut dari posisi terakhir.`);
        }
        void refreshList().catch((e) => console.error(e));
      }
    } catch (e) {
      console.warn("status sync:", e);
    }
  };

  // Polling tiap 4 dtk (query ringan, take 10) — progres terlihat bahkan
  // setelah kembali dari menu lain / dibuka di tab lain.
  const runStatusRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    runStatusRef.current = refreshRunStatus; // closure terbaru tiap render
  });
  useEffect(() => {
    void runStatusRef.current();
    const t = setInterval(() => void runStatusRef.current(), 4000);
    return () => clearInterval(t);
  }, [bgActive]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/orders/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Gagal sync (${res.status})`);
        return;
      }
      const guardErrors = (data.errors as string[] | undefined) ?? [];
      const started = Number(data.started ?? 0);
      const stillRunning = Number(data.stillRunning ?? 0);
      if (started > 0 || stillRunning > 0) {
        bgWasActive.current = true; // alert penutup muncul saat run selesai
        setBgActive(true);
        void refreshRunStatus();
      }
      alert(
        `Sync pesanan berjalan di latar belakang${started > 0 ? ` — ${started} akun mulai menarik order` : ""}. ` +
          `Anda bisa berpindah menu; progres tampil di halaman ini.` +
          (stillRunning > 0 ? `\n\n${stillRunning} akun masih berjalan dari sync sebelumnya.` : "") +
          (guardErrors.length > 0 ? `\n\nCatatan:\n- ${guardErrors.join("\n- ")}` : "")
      );
    } catch (e) {
      console.error(e);
      setError("Terjadi kesalahan saat sync.");
    } finally {
      setSyncing(false);
    }
  };

  const handleReconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/orders/fulfillment/reconcile", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Gagal sync resi (${res.status})`);
        return;
      }
      const detail = (data.results as { label?: string; scanned?: number; updated?: number; error?: string }[])
        ?.map((r) => (r.error ? `${r.label}: ${r.error}` : `${r.label}: ${r.updated ?? 0}/${r.scanned ?? 0} resi dilengkapi`))
        .join("\n");
      alert(`Sync resi selesai — ${data.updated ?? 0} paket diperbarui dari ${data.scanned ?? 0}.${detail ? `\n\n${detail}` : ""}`);
      const refreshed = await fetchOrders({ page, tab: currentTab, subTab: currentSubTab, q, searchType: searchType.id, sort, from, to });
      setOrders(refreshed.orders ?? []);
      setTotal(refreshed.total ?? 0);
      setPageCount(refreshed.pageCount ?? 1);
      setSelected(new Set());
    } catch (e) {
      console.error(e);
      setError("Terjadi kesalahan saat sync resi.");
    } finally {
      setReconciling(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = orders.map((o) => o.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const printSelectedBulkLabel = async (targets: Order[]) => {
    if (printingBulk) return;
    setPrintingBulk(true);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/orders/bulk-label", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: targets.map((o) => o.id) }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error ?? `Gagal mencetak label (${res.status})`);
        return;
      }
      if (data.pdfBase64) {
        // Satu PDF gabungan (multi halaman) → 1 window cetak, print sekali jalan.
        printPdfWindow(
          URL.createObjectURL(pdfBlobFromBase64(data.pdfBase64)),
          `Label Gabungan (${data.count})`
        );
      }
      const failedList = (data.failed ?? []) as { orderNo: string; reason: string }[];
      if (failedList.length > 0) {
        const detail = failedList.map((f) => `- ${f.orderNo}: ${f.reason}`).join("\n");
        alert(
          `Label gabungan: ${data.count ?? 0} berhasil.${detail ? `\n\nOrder yang terlewat (label resmi belum tersedia):\n${detail}` : ""}`
        );
      } else if (!data.pdfBase64) {
        alert("Tidak ada label resmi yang bisa digabung (order belum di-ship / tidak punya paket).");
      }
    } catch (e) {
      console.error(e);
      alert("Terjadi kesalahan saat mencetak label gabungan.");
    } finally {
      setPrintingBulk(false);
    }
  };

  /** Label pengiriman thermal (browser print) dengan rincian produk & varian lengkap. */
  const printLocalLabels = async (targets: Order[]) => {
    if (targets.length === 0) return;
    const details = await Promise.all(targets.map((o) => fetchOrderDetail(o.id)));
    const printable = details
      .filter((d): d is OrderDetail => d !== null)
      .map((d, index) => {
        const p = toPrintableFromDetail(d);
        const orig = targets[index];
        const origShip = orig?.shipments?.[0];
        if (!p.trackingNumber && origShip?.trackingNo) {
          p.trackingNumber = origShip.trackingNo;
        }
        if (!p.courier && origShip?.carrier) {
          p.courier = origShip.carrier;
        }
        return p;
      });
    if (printable.length === 0) {
      alert("Gagal memuat data penerima untuk label.");
      return;
    }
    printOrders(printable, "Label");
    if (printable.length < targets.length) {
      alert(`${targets.length - printable.length} pesanan dilewati (gagal memuat data pesanan).`);
    }
  };

  const printSelectedBulk = async (type: PrintType) => {
    const targets = orders.filter((o) => selected.has(o.id));
    if (targets.length === 0) return;
    if (type === "Label") {
      // Label resmi digabung jadi 1 PDF multi-halaman di server (sudah bertempel varian produk).
      // Order non-TikTok dicetak label lokal dari data pesanan.
      const tt = targets.filter((o) => o.account?.platform === "TIKTOK_SHOP");
      const local = targets.filter((o) => o.account?.platform !== "TIKTOK_SHOP");
      if (tt.length > 0) await printSelectedBulkLabel(tt);
      if (local.length > 0) await printLocalLabels(local);
      return;
    }
    printOrders(targets.map(toPrintable), type);
  };

  const printOrder = async (order: Order, type: PrintType) => {
    if (type === "Label") {
      // Utamakan label RESMI TikTok ASLI (sudah ditambahkan tabel varian langsung di PDF resmi)
      if (order.account?.platform === "TIKTOK_SHOP") {
        const official = await fetchOfficialLabel(order.id);
        if (official?.pdfBase64) {
          printPdfWindow(
            URL.createObjectURL(pdfBlobFromBase64(official.pdfBase64)),
            `Label ${order.orderNo}`
          );
          return;
        }
        if (official?.docUrl) {
          printShippingDocument(official.docUrl, `Label ${order.orderNo}`);
          return;
        }
      }
      const detail = await fetchOrderDetail(order.id);
      if (!detail) {
        alert("Gagal memuat data penerima untuk label.");
        return;
      }
      const printable = toPrintableFromDetail(detail);
      const ship = order.shipments?.[0];
      if (!printable.trackingNumber && ship?.trackingNo) {
        printable.trackingNumber = ship.trackingNo;
      }
      if (!printable.courier && ship?.carrier) {
        printable.courier = ship.carrier;
      }
      printOrders([printable], "Label");
      return;
    }
    printOrders([toPrintable(order)], type);
  };

  const handleExportVisible = () => {
    if (orders.length === 0) return;
    const csv = ordersToCsv(orders.map(toExportRow));
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`pesanan-${date}.csv`, csv);
  };

  const allSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));

  /** Apakah tab aktif adalah "Siap Dikirim" (AWAITING_SHIPMENT)? */
  const isReadyTab = currentTab.id === "ready";

  /** handlePickup — buka modal "Atur Pengiriman" untuk pesanan terpilih. */
  const handlePickup = () => {
    const readySelected = orders.filter(
      (o) => selected.has(o.id) && o.status === "AWAITING_SHIPMENT"
    );
    // Pisahkan per platform: TikTok → modal slot handover, Shopee → ShopeeShipModal
    // (booking via Shopee Open API). Campuran tidak diproses dalam satu aksi.
    const tiktok = readySelected.filter((o) => o.account?.platform === "TIKTOK_SHOP");
    const shopee = readySelected.filter((o) => o.account?.platform === "SHOPEE");
    if (tiktok.length > 0 && shopee.length > 0) {
      alert("Pilih order TikTok atau Shopee saja dalam satu kali Atur Pengiriman.");
      return;
    }
    if (shopee.length > 0) {
      setShopeeTargets(shopee.map(toPickupOrder));
      return;
    }
    if (tiktok.length > 0) {
      setPickupTargets(tiktok.map(toPickupOrder));
      return;
    }
    if (readySelected.length > 0) {
      alert("Atur Pengiriman hanya untuk order TikTok Shop & Shopee.");
    }
  };

  const handlePickupConfirm = (result: PickupShipResult) => {
    setPickupTargets(null);
    setShopeeTargets(null);
    setPickupResult(result);
  };

  const handlePickupSuccessClose = async () => {
    setPickupResult(null);
    await refreshList();
  };

  const handleOpenPrintLabels = (successfulOrderIds: string[]) => {
    setPrintOrderIds(successfulOrderIds);
    setShowPrintModal(true);
  };

  const handlePrintDone = async () => {
    setShowPrintModal(false);
    setPickupResult(null);
    setPrintOrderIds([]);
    await refreshList();
  };

  const handleOpenDetail = (order: Order) => {
    router.push(`/orders/detail/${order.id}`);
  };

  return (
    <div className="p-6 font-sans h-full flex flex-col">
      {/* Page Header */}
      <PageHeader
        title="Pesanan"
        description="Kelola pesanan dari semua marketplace — sync, proses pengiriman, cetak label/resi."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Arsip">
              <Archive size={18} />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Email">
              <Mail size={18} />
            </Button>
            <Button
              onClick={handleSync}
              disabled={syncing || bgActive}
              className="gap-2"
            >
              <RefreshCw size={16} className={syncing || bgActive ? "animate-spin" : ""} />
              {bgActive ? "Berjalan di latar belakang..." : syncing ? "Memulai sync..." : "Sync Pesanan"}
            </Button>
            <Button
              variant="outline"
              onClick={handleReconcile}
              disabled={reconciling}
              className="gap-2 text-gray-900 border-gray-200 hover:bg-gray-50"
            >
              <RefreshCw size={16} className={reconciling ? "animate-spin" : ""} />
              {reconciling ? "Menyinkronkan Resi..." : "Sync Resi"}
            </Button>
            <Button variant="outline" onClick={handleExportVisible} className="gap-2">
              Unduh CSV <ChevronDown size={16} />
            </Button>
          </div>
        }
      />

      {/* Progres background run (SyncRun) */}
      {bgActive && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <RefreshCw size={14} className="animate-spin shrink-0" />
          <span>
            Menarik order di latar belakang — <b>{bgProgress?.fetched ?? 0} ditarik</b>, {bgProgress?.created ?? 0} baru,{" "}
            {bgProgress?.skipped ?? 0} sudah ada
            {bgProgress?.phase === "rate_wait" ? " · jeda rate limit API (wajar)" : ""}. Anda bisa berpindah menu; halaman ini
            menampilkan progres terbaru.
          </span>
        </div>
      )}

      {/* Fase 1 — edukasi batas API & pola pakai */}
      {!infoDismissed && (
        <Alert className="mt-3 border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-700">
          <Info size={16} className="text-amber-700" />
          <AlertTitle className="flex w-full items-start justify-between gap-2 text-amber-900">
            Tentang sinkronisasi pesanan masal
            <button
              type="button"
              onClick={() => setInfoDismissed(true)}
              className="rounded p-0.5 hover:bg-amber-100"
              aria-label="Tutup informasi"
            >
              <X size={14} />
            </button>
          </AlertTitle>
          <AlertDescription className="text-amber-900/90">
            <p>
              1. API marketplace mengambil pesanan maksimal ±100–1.000 data per permintaan (pagination limit). Indikator yang
              berputar lama atau tertahan pada angka tertentu adalah <b>normal</b> — sistem menunggu jeda rate limit agar koneksi
              toko tidak diblokir.
            </p>
            <p>2. Operasional harian: gunakan filter tanggal 3–7 hari terakhir atau tab &ldquo;Pesanan Baru&rdquo; / &ldquo;Siap Dikirim&rdquo;.</p>
            <p>3. Histori lengkap (pembukuan/analisis): sync berjalan aman di latar belakang — Anda bisa berpindah menu dan kembali kapan saja.</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Card */}
      <DataCard
        className="flex-1 flex flex-col overflow-hidden min-h-0"
        contentClassName="flex-1 flex flex-col overflow-hidden p-0"
      >
        {/* Tabs */}
        <div className="flex items-center overflow-x-auto border-b border-gray-200 px-4 bg-white">
          {TABS.map((tab) => {
            const count = tab.statuses === null
              ? Object.values(counts).reduce((a, b) => a + b, 0)
              : (tab.statuses ?? []).reduce((acc, s) => acc + (counts[s] ?? 0), 0);
            return (
              <button
                key={tab.id}
                onClick={() => handleTab(tab.id)}
                className={`whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                  activeTab === tab.id
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <StatusBadge status={activeTab === tab.id ? "info" : "inactive"} label={String(count)} className="text-[10px] px-1.5 py-0.5" />
                )}
              </button>
            );
          })}
        </div>

        {/* Sub-Tabs (hanya untuk tab tertentu) */}
        {currentSubTabs && (
          <div className="flex items-center gap-0 border-b border-gray-100 px-4 bg-gray-50/50">
            {currentSubTabs.map((sub) => {
              const subCount = sub.id === "all"
                ? (currentTab.statuses ?? []).reduce((acc, s) => acc + (counts[s] ?? 0), 0)
                : sub.statuses.reduce((acc, s) => acc + (counts[s] ?? 0), 0);
              return (
                <button
                  key={sub.id}
                  onClick={() => handleSubTab(sub.id)}
                  className={`whitespace-nowrap px-4 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                    activeSubTab === sub.id
                      ? "border-gray-900 text-gray-900"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {sub.label}
                  <StatusBadge status={activeSubTab === sub.id ? "info" : "inactive"} label={String(subCount)} className="text-[10px] px-1.5 py-0.5" />
                </button>
              );
            })}
          </div>
        )}

        {/* Filter Row */}
        <div className="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap bg-white">
          <div className="flex bg-white border border-gray-200 rounded-lg h-10 flex-1 max-w-xl relative">
            {/* Keyword type dropdown */}
            <div className="relative" ref={searchTypeRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchTypeOpen((v) => !v)}
                className="h-full px-3 bg-gray-50 border-r border-gray-200 text-sm text-gray-700 font-medium flex items-center gap-1.5 hover:bg-gray-100 min-w-[130px] rounded-l-lg"
              >
                <span>{searchType.label}</span>
                <ChevronDown size={13} className="ml-auto text-gray-400" />
              </Button>
              {searchTypeOpen && (
                <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1.5">
                  {SEARCH_TYPES.map((type) => (
                    <Button
                      key={type.id}
                      variant="ghost"
                      className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 justify-start"
                      onClick={() => { setSearchType(type); setSearchTypeOpen(false); setSearchInput(""); setQ(""); }}
                    >
                      {type.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 flex items-center px-3 gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={searchType.placeholder}
                className="w-full text-sm outline-none bg-transparent"
              />
              <Search size={16} className="text-gray-400 shrink-0" />
            </div>
          </div>

          <div className="relative" ref={sortRef}>
            <button
              onClick={() => setSortOpen((v) => !v)}
              className={`h-10 px-4 border rounded-lg text-sm bg-white flex items-center gap-2 min-w-[140px] max-w-[200px] justify-between ${
                sortOpen
                  ? "border-gray-500 text-gray-900 bg-gray-50/70 ring-2 ring-gray-500/15"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              <span className="truncate">{sort.label}</span> <ChevronDown size={14} className="shrink-0" />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-20 py-2">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleSortChange(opt)}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 ${
                      sort.id === opt.id
                        ? "font-semibold text-gray-900 bg-gray-50"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {sort.id === opt.id && <span className="w-1.5 h-1.5 rounded-full bg-gray-900 shrink-0" />}
                    {sort.id !== opt.id && <span className="w-1.5 h-1.5 shrink-0" />}
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 h-10 border border-gray-200 rounded-lg px-3 bg-white">
            <Calendar size={16} className="text-gray-400" />
            <input
              type="date"
              value={from}
              onChange={(e) => handleDateChange("from", e.target.value)}
              className="text-sm outline-none w-[130px] text-gray-600"
            />
            <span className="text-gray-400">s.d.</span>
            <input
              type="date"
              value={to}
              onChange={(e) => handleDateChange("to", e.target.value)}
              className="text-sm outline-none w-[130px] text-gray-600"
            />
          </div>

          {hasActiveFilters && (
            <Button
              variant="outline"
              onClick={handleClearFilters}
              className="h-10 gap-2 text-gray-600"
            >
              <Filter size={16} /> Reset
            </Button>
          )}
        </div>

        {/* Bulk Action & Pagination */}
        <div className="px-4 py-3 bg-gray-50/50 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                checked={allSelected}
                onChange={toggleSelectAll}
              />
              <span className="text-sm font-medium text-gray-700">Pilih Semua</span>
            </label>
            {selected.size > 0 && (
              <>
                {isReadyTab && (
                  <button
                    onClick={handlePickup}
                    disabled={printingBulk}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gray-900 rounded-md text-xs font-semibold text-white hover:bg-gray-900 disabled:opacity-50 shadow-xs transition-colors"
                  >
                    <PackageCheck size={14} /> Atur Pengiriman ({selected.size})
                  </button>
                )}
                <PrintDropdown
                  variant="filled"
                  prefixIcon={<Printer size={14} />}
                  label={`Cetak (${selected.size})`}
                  placement="bottom-left"
                  onSelect={(type) => printSelectedBulk(type)}
                  items={[
                    // M8c — "Label" selalu ditawarkan: order TikTok → label resmi
                    // TikTok (PDF gabungan), order non-TikTok → label lokal.
                    {
                      id: "Label" as PrintType,
                      label: "Cetak Label",
                      description: labelMenuDescription(orders, selected),
                    },
                    { id: "Invoice" as PrintType, label: "Cetak Invoice", description: "Faktur pesanan terpilih" },
                    { id: "PackingList" as PrintType, label: "Cetak Packing List", description: "Daftar packing pesanan terpilih" },
                  ]}
                />
              </>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{total}</span>
            <span>Total pesanan</span>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Sebelumnya
                </Button>
                <span className="px-2 text-xs">
                  Hal {page} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                >
                  Berikutnya
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Orders List */}
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
          {loading ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 rounded-xl bg-white border border-gray-200 animate-pulse"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={<RefreshCw size={40} />}
              title="Gagal memuat pesanan"
              description={error}
              action={
                <Button variant="outline" onClick={refreshList} className="gap-2">
                  <RefreshCw size={14} /> Coba lagi
                </Button>
              }
            />
          ) : orders.length === 0 ? (
            <EmptyState
              icon={<PackageCheck size={40} />}
              title="Tidak ada pesanan"
              description="Belum ada pesanan pada filter ini. Coba ganti tab/status, ubah kata kunci, atau jalankan Sync Pesanan."
              action={
                <Button variant="outline" onClick={handleSync} disabled={syncing} className="gap-2">
                  <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> Sync Pesanan
                </Button>
              }
            />
          ) : (
            orders.map((order) => (
              <OrderCard
                key={order.id}
                order={toCardOrder(order)}
                checked={selected.has(order.id)}
                onToggleChecked={() => toggleSelect(order.id)}
                onSync={handleSync}
                onPrint={(type) => printOrder(order, type)}
                onPickup={() => {
                  // Single-order pickup dari kartu — buka modal sesuai platform.
                  const o = order;
                  const target = toPickupOrder(o);
                  if (o.account?.platform === "SHOPEE") {
                    setShopeeTargets([target]);
                    return;
                  }
                  if (o.account?.platform !== "TIKTOK_SHOP") {
                    alert("Atur Pengiriman hanya untuk order TikTok Shop & Shopee.");
                    return;
                  }
                  setPickupTargets([target]);
                }}
                shipping={false}
                onDetail={() => handleOpenDetail(order)}
              />
            ))
          )}
        </div>
      </DataCard>

      {/* Modal Alur Pengiriman */}
      {pickupTargets && (
        <RequestPickupModal
          orders={pickupTargets}
          onClose={() => setPickupTargets(null)}
          onConfirm={handlePickupConfirm}
        />
      )}

      {shopeeTargets && (
        <ShopeeShipModal
          orders={shopeeTargets}
          onClose={() => setShopeeTargets(null)}
          onConfirm={handlePickupConfirm}
        />
      )}

      {pickupResult && (
        <PickupSuccessModal
          result={pickupResult}
          onClose={handlePickupSuccessClose}
          onPrintLabels={handleOpenPrintLabels}
        />
      )}

      {showPrintModal && pickupResult && (
        <PrintMethodModal
          title={`Label Pengiriman (${printOrderIds.length})`}
          orderIds={printOrderIds}
          onClose={() => setShowPrintModal(false)}
          onDone={handlePrintDone}
        />
      )}
    </div>
  );
}