"use client";

import { notify } from "@/components/ui/notify";
import { PageState } from "@/components/ui/feedback";
import { friendlyError } from "@/lib/ui/feedback";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Download, Filter, Info, MoreHorizontal, PackageCheck, Printer, RefreshCw, Search, X } from "lucide-react";
import OrderCard, { type PrintType } from "./OrderCard";
import PrintDropdown from "./PrintDropdown";
import { printOrders, printShippingDocument, openPrintWindow, fillPrintPdfWindow, pdfBlobFromBase64, type PrintableOrder } from "./printOrders";
import { ordersToCsv, downloadCsv, type ExportOrderRow } from "./exportOrders";
import RequestPickupModal, { type PickupShipResult, type RequestPickupOrder } from "./RequestPickupModal";
import ShopeeShipModal from "./ShopeeShipModal";
import PickupSuccessModal from "./PickupSuccessModal";
import PrintMethodModal from "./PrintMethodModal";
import OrderHistoryDialog, { type OrderHistoryRange } from "./OrderHistoryDialog";
import { authFetch } from "@/lib/utils/api-client";
import { PageHeader } from "@/components/ui/page-header";
import { DataCard } from "@/components/ui/data-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

const PAGE_SIZES = [20, 50, 100, 250, 500, 1000];

const TABS: { id: string; label: string; statuses: string[] | null }[] = [
  { id: "all", label: "Semua", statuses: null },
  { id: "unpaid", label: "Belum Dibayar", statuses: ["UNPAID"] },
  // ON_HOLD = pembayaran masuk & sedang dicek; belum wajib kirim.
  { id: "new", label: "Pembayaran Sedang Diperiksa", statuses: ["ON_HOLD"] },
  { id: "ready", label: "Perlu Diproses", statuses: ["AWAITING_SHIPMENT"] },
  {
    id: "shipped",
    label: "Telah Diproses",
    statuses: ["PARTIALLY_SHIPPING", "AWAITING_COLLECTION", "IN_TRANSIT", "PROCESSED"],
  },
  { id: "completed", label: "Selesai", statuses: ["DELIVERED", "COMPLETED"] },
  { id: "cancelled", label: "Pembatalan", statuses: ["CANCELLED"] },
  // TikTok tidak menyediakan status order untuk return (return = entitas RMA terpisah).
  { id: "returned", label: "Pengembalian", statuses: [] },
];

// Sub-tab untuk tab yang memiliki sub-kategori status
type SubTab = { id: string; label: string; statuses: string[] };
const SUB_TABS: Record<string, SubTab[]> = {
  shipped: [
    { id: "all", label: "Semua", statuses: ["PARTIALLY_SHIPPING", "AWAITING_COLLECTION", "IN_TRANSIT", "PROCESSED"] },
    { id: "in_transit", label: "Dalam Pengiriman", statuses: ["IN_TRANSIT", "PARTIALLY_SHIPPING"] },
    { id: "delivered", label: "Menunggu Diambil Kurir", statuses: ["AWAITING_COLLECTION"] },
  ],
};

const SORT_OPTIONS: { id: string; label: string; field: "createTime" | "amount" | "shippingDueTime"; dir: "desc" | "asc" }[] = [
  { id: "newest", label: "Tanggal Pesanan: Terbaru", field: "createTime", dir: "desc" },
  { id: "oldest", label: "Tanggal Pesanan: Terlama", field: "createTime", dir: "asc" },
  { id: "amount_low", label: "Nilai Pesanan: Terendah", field: "amount", dir: "asc" },
  { id: "amount_high", label: "Nilai Pesanan: Tertinggi", field: "amount", dir: "desc" },
  { id: "deadline_soon", label: "Batas Kirim: Paling Dekat", field: "shippingDueTime", dir: "asc" },
  { id: "deadline_late", label: "Batas Kirim: Paling Jauh", field: "shippingDueTime", dir: "desc" },
];

type OrderItem = {
  id: string;
  channelSku: string;
  productId: string | null;
  productName?: string | null;
  skuName?: string | null;
  imageUrl: string | null;
  qty: number;
  price: number | null;
  variant?: {
    sku: string;
    masterProduct: { name: string; imageUrl?: string | null } | null;
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
  sellerNote?: string | null;
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
  const productName = first?.variant?.masterProduct?.name ?? first?.productName ?? first?.productId ?? "-";
  const productVariant = first?.skuName ?? first?.variant?.sku ?? `SKU ${first?.channelSku ?? "-"}`;
  const price = formatPrice(first?.price, "");
  const orderDate = o.createTime
    ? new Date(o.createTime).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
    : "-";
  const storeName = o.account?.label ?? "-";
  const platform = PLATFORM[o.account?.platform ?? ""] ?? o.account?.platform ?? "-";
  const shipment = o.shipments?.find((s) => s.trackingNo) ?? o.shipments?.find((s) => s.carrier) ?? o.shipments?.[0] ?? null;

  return {
    id: o.id,
    status: o.status,
    orderId: o.orderNo,
    deadline: orderDate,
    storeName,
    platform,
    productName,
    productVariant,
    // Order Shopee tidak punya gambar item dari API → fallback gambar produk master.
    productImage: first?.imageUrl ?? first?.variant?.masterProduct?.imageUrl ?? null,
    qty: totalQty,
    price,
    totalPrice: formatPrice(o.amount),
    paymentMethod: o.currency ?? "IDR",
    buyerName: o.buyerName ?? "-",
    buyerPhone: "-",
    address: "-",
    orderDate,
    sellerNote: null,
    buyerNote: null,
    pickupLocation: null,
    fulfillmentStage: null,
    courier: shipment?.carrier ?? "-",
    trackingNumber: shipment?.trackingNo ?? "-",
    shippingDueTime: o.shippingDueTime,
    items: o.items.map((it) => ({
      name: it.variant?.masterProduct?.name ?? it.productName ?? it.productId ?? "-",
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
      name: it.variant?.masterProduct?.name ?? it.productName ?? it.productId ?? "-",
      variant: it.variant?.sku ?? `SKU ${it.channelSku}`,
      qty: it.qty,
      price: formatPrice(it.price, "Rp 0"),
    })),
  };
}

async function fetchOrderDetail(id: string): Promise<OrderDetail | null> {
  try {
    const res = await authFetch(`/api/orders/${id}`, {
      headers: {},
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
): Promise<{ docUrl: string; pdfBase64?: string; trackingNumber: string | null; error?: string } | null> {
  try {
    const res = await authFetch(`/api/orders/${id}/label`, {
      headers: {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { docUrl: "", trackingNumber: null, error: body?.error ?? `Gagal mengambil resi (${res.status})` };
    }
    const data = await res.json();
    return data?.pdfBase64
      ? {
        docUrl: "",
        pdfBase64: data.pdfBase64 ?? undefined,
        trackingNumber: data.trackingNumber ?? null,
      }
      : { docUrl: "", trackingNumber: null, error: "Marketplace belum mengembalikan dokumen resi." };
  } catch (e) {
    console.error(e);
    return { docUrl: "", trackingNumber: null, error: "Koneksi ke marketplace gagal. Coba lagi." };
  }
}

function toPrintableFromDetail(o: OrderDetail): PrintableOrder {
  const shipment = o.shipments.find((s) => s.trackingNo) ?? o.shipments.find((s) => s.carrier) ?? o.shipments[0];
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
    sellerNote: o.sellerNote ?? o.buyerNote ?? undefined,
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
      .map((it) => it.variant?.masterProduct?.name ?? it.productName ?? it.productId ?? it.channelSku)
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
  pageSize: number;
  tab: { id: string; statuses: string[] | null };
  q: string;
  searchType: string;
  sort: (typeof SORT_OPTIONS)[number];
  from: string;
  to: string;
  platform: string;
  account: string;
  category: string;
}) {
  const params = new URLSearchParams();
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize));
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
  if (input.platform !== "all") params.set("platform", input.platform);
  if (input.account !== "all") params.set("account", input.account);
  if (input.category !== "all") params.set("category", input.category);
  return params.toString();
}

const SEARCH_TYPES = [
  { id: "keyword", label: "Keyword Pesanan", placeholder: "Cari nomor pesanan, produk, pembeli, resi" },
  { id: "orderNo", label: "No. Pesanan", placeholder: "Cari nomor pesanan" },
  { id: "sku", label: "SKU", placeholder: "Cari SKU produk" },
  { id: "product", label: "Produk Master", placeholder: "Cari nama produk" },
  { id: "tracking", label: "Nomor Resi", placeholder: "Cari nomor resi" },
];

const SELECT_CLASS =
  "h-9 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-foreground hover:bg-muted/70";

export default function OrdersPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("all");
  const [activeSubTab, setActiveSubTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [searchType, setSearchType] = useState(SEARCH_TYPES[0]);
  const [sort, setSort] = useState(SORT_OPTIONS[0]);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Tutup menu "Lainnya" saat klik di luar
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [filterOptions, setFilterOptions] = useState<{
    accounts: Array<{ id: string; label: string; platform: string }>;
    categories: string[];
  }>({ accounts: [], categories: [] });
  const [urlReady, setUrlReady] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(1000);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab && TABS.some((item) => item.id === tab && item.id !== "returned")) setActiveTab(tab);
      const subTab = params.get("subtab");
      if (subTab) setActiveSubTab(subTab);
      const initialQ = params.get("q") ?? "";
      setQ(initialQ);
      setSearchInput(initialQ);
      setSearchType(SEARCH_TYPES.find((item) => item.id === params.get("searchType")) ?? SEARCH_TYPES[0]);
      setSort(SORT_OPTIONS.find((item) => item.id === params.get("sort")) ?? SORT_OPTIONS[0]);
      setFrom(params.get("from") ?? "");
      setTo(params.get("to") ?? "");
      setPlatformFilter(params.get("platform") ?? "all");
      setAccountFilter(params.get("account") ?? "all");
      setCategoryFilter(params.get("category") ?? "all");
      setUrlReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    if (activeTab !== "all") params.set("tab", activeTab);
    if (activeSubTab !== "all") params.set("subtab", activeSubTab);
    if (q.trim()) {
      params.set("q", q.trim());
      if (searchType.id !== "keyword") params.set("searchType", searchType.id);
    }
    if (sort.id !== "newest") params.set("sort", sort.id);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (platformFilter !== "all") params.set("platform", platformFilter);
    if (accountFilter !== "all") params.set("account", accountFilter);
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }, [accountFilter, activeSubTab, activeTab, categoryFilter, from, platformFilter, q, searchType.id, sort.id, to, urlReady]);

  const fetchOrders = useCallback(
    async (opts: { page: number; tab: typeof currentTab; subTab: typeof currentSubTab; q: string; searchType: string; sort: typeof sort; from: string; to: string; platform: string; account: string; category: string }) => {
      // Gunakan statuses dari sub-tab jika ada & bukan tab 'all'
      const effectiveTab = opts.subTab && opts.subTab.id !== "all"
        ? { id: opts.tab.id, label: opts.tab.label, statuses: opts.subTab.statuses }
        : opts.tab;
      const query = buildQueryParams({ ...opts, pageSize, tab: effectiveTab });
      const res = await authFetch(`/api/orders?${query}`, {
        headers: {},
      });
      if (!res.ok) throw new Error(`Terjadi kesalahan saat memuat pesanan (${res.status})`);
      const data = await res.json();
      return data;
    },
    [pageSize]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchOrders({ page, tab: currentTab, subTab: currentSubTab, q, searchType: searchType.id, sort, from, to, platform: platformFilter, account: accountFilter, category: categoryFilter });
        if (cancelled) return;
        setOrders(data.orders ?? []);
        setTotal(data.total ?? 0);
        setPageCount(data.pageCount ?? 1);
        setCounts(data.counts ?? {});
        setFilterOptions(data.filters ?? { accounts: [], categories: [] });
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
  }, [page, currentTab, currentSubTab, q, searchType.id, sort, from, to, platformFilter, accountFilter, categoryFilter, fetchOrders]);

  const handleTab = (id: string) => {
    if (id === "returned") { router.push("/orders/returns"); return; }
    setActiveTab(id);
    setActiveSubTab("all");
    setPage(1);
  };

  const handleSubTab = (id: string) => {
    setActiveSubTab(id);
    setPage(1);
  };

  // Debounce: tunggu jeda pengetikan sebelum query dicommit & fetch dijalankan.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleSearchTypeChange = (id: string) => {
    setSearchType(SEARCH_TYPES.find((item) => item.id === id) ?? SEARCH_TYPES[0]);
    setSearchInput("");
    setQ("");
    setPage(1);
  };

  const handleSortChange = (id: string) => {
    setSort(SORT_OPTIONS.find((item) => item.id === id) ?? SORT_OPTIONS[0]);
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
    setPlatformFilter("all");
    setAccountFilter("all");
    setCategoryFilter("all");
    setPage(1);
  };

  const hasActiveFilters = q.trim() !== "" || from !== "" || to !== "" || sort.id !== "newest" || platformFilter !== "all" || accountFilter !== "all" || categoryFilter !== "all";

  const refreshList = async () => {
    try {
      const refreshed = await fetchOrders({ page, tab: currentTab, subTab: currentSubTab, q, searchType: searchType.id, sort, from, to, platform: platformFilter, account: accountFilter, category: categoryFilter });
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
      const res = await authFetch("/api/orders/sync/status", {
        headers: {},
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
          notify("success", `Sync selesai — ${last.created} order baru, ${last.skipped} sudah ada (${last.fetched} ditarik).`);
        } else if (last?.status === "FAILED") {
          notify("error", `Sync gagal: ${last.error ?? "-"}\n\nKlik "Perbarui Pesanan (Sync)" untuk lanjut dari posisi terakhir.`);
        }
        void refreshList().catch((e) => console.error(e));
      }
    } catch (e) {
      console.warn("status sync:", e);
    }
  };

  // Polling tiap 4 dtk (query ringan, take 10) saat bgActive aktif
  const runStatusRef = useRef<() => Promise<void>>(async () => { });
  useEffect(() => {
    runStatusRef.current = refreshRunStatus; // closure terbaru tiap render
  });
  useEffect(() => {
    if (!bgActive) return;
    void runStatusRef.current();
    const t = setInterval(() => void runStatusRef.current(), 4000);
    return () => clearInterval(t);
  }, [bgActive]);

  const handleSync = async (history?: OrderHistoryRange): Promise<boolean> => {
    setSyncing(true);
    setError(null);
    try {
      const res = await authFetch("/api/orders/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(history ? { history } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Gagal sync (${res.status})`);
        return false;
      }
      const guardErrors = (data.errors as string[] | undefined) ?? [];
      const started = Number(data.started ?? 0);
      const stillRunning = Number(data.stillRunning ?? 0);
      if (started === 0 && stillRunning === 0) {
        setError(guardErrors.join("\n") || "Belum ada toko terhubung yang dapat disinkronkan.");
        return false;
      }
      if (guardErrors.length > 0 && (started > 0 || stillRunning > 0)) {
        notify("warning", `Sebagian akun gagal disinkronkan:\n${guardErrors.join("\n")}`);
      }
      if (started > 0 || stillRunning > 0) {
        bgWasActive.current = true; // alert penutup muncul saat run selesai
        setBgActive(true);
        void refreshRunStatus();
      }
      notify("info", `${history ? "Pengambilan riwayat" : "Sync pesanan"} berjalan di latar belakang${started > 0 ? ` — ${started} akun mulai menarik order` : ""}. ` +
        `Anda bisa berpindah menu; progres tampil di halaman ini.` +
        (stillRunning > 0 ? `\n\n${stillRunning} akun masih berjalan dari sync sebelumnya.` : "") +
        (guardErrors.length > 0 ? `\n\nCatatan:\n- ${guardErrors.join("\n- ")}` : ""));
      return true;
    } catch (e) {
      console.error(e);
      setError("Terjadi kesalahan saat sync.");
      return false;
    } finally {
      setSyncing(false);
    }
  };

  const handleReconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      const res = await authFetch("/api/orders/fulfillment/reconcile", {
        method: "POST",
        headers: {},
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Gagal sync resi (${res.status})`);
        return;
      }
      const detail = (data.results as { label?: string; scanned?: number; updated?: number; error?: string }[])
        ?.map((r) => (r.error ? `${r.label}: ${r.error}` : `${r.label}: ${r.updated ?? 0}/${r.scanned ?? 0} resi dilengkapi`))
        .join("\n");
      const failed = data.results?.some((result: { error?: string }) => result.error);
      notify(failed ? "error" : "success", failed ? "Sebagian resi belum diperbarui. Periksa koneksi toko, lalu coba lagi." : `Sinkron resi selesai. ${data.updated ?? 0} paket diperbarui.`, { details: detail });
      const refreshed = await fetchOrders({ page, tab: currentTab, subTab: currentSubTab, q, searchType: searchType.id, sort, from, to, platform: platformFilter, account: accountFilter, category: categoryFilter });
      setOrders(refreshed.orders ?? []);
      setTotal(refreshed.total ?? 0);
      setPageCount(refreshed.pageCount ?? 1);
      setCounts(refreshed.counts ?? counts);
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
    // Buka jendela sinkron (masih dalam user gesture) — fetch label bisa jauh
    // lebih lama dari masa user gesture, window.open sesudah await diblokir.
    const win = openPrintWindow("Label Gabungan");
    try {
      const res = await authFetch("/api/orders/bulk-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: targets.map((o) => o.id) }),
      });
      const data = await res.json();
      if (!res.ok) {
        win?.close();
        notify("error", data?.error ?? `Gagal mencetak label (${res.status})`);
        return;
      }
      if (data.pdfBase64 && win) {
        // Satu PDF gabungan (multi halaman) → 1 window cetak, print sekali jalan.
        fillPrintPdfWindow(
          win,
          URL.createObjectURL(pdfBlobFromBase64(data.pdfBase64)),
          `Label Gabungan (${data.count})`
        );
      } else if (win) {
        win.close();
      }
      const failedList = (data.failed ?? []) as { orderNo: string; reason: string }[];
      if (failedList.length > 0) {
        const detail = failedList.map((f) => `- ${f.orderNo}: ${f.reason}`).join("\n");
        notify("warning", `Label gabungan: ${data.count ?? 0} berhasil.${detail ? `\n\nOrder yang terlewat (label resmi belum tersedia):\n${detail}` : ""}`);
      } else if (!data.pdfBase64) {
        notify("error", "Tidak ada label resmi yang bisa digabung (order belum di-ship / tidak punya paket).");
      }
    } catch (e) {
      console.error(e);
      win?.close();
      notify("error", "Terjadi kesalahan saat mencetak label gabungan.");
    } finally {
      setPrintingBulk(false);
    }
  };

  /** Label pengiriman thermal (browser print) dengan rincian produk & varian lengkap. */
  const printLocalLabels = async (targets: Order[]) => {
    if (targets.length === 0) return;
    // Buka jendela sinkron sebelum fetch detail (pop-up blocker vs user gesture).
    const win = openPrintWindow("Cetak Label");
    if (!win) return;
    const details = await Promise.all(targets.map((o) => fetchOrderDetail(o.id)));
    const printable: PrintableOrder[] = [];
    details.forEach((d, index) => {
      if (!d) return;
      const p = toPrintableFromDetail(d);
      const orig = targets[index];
      const origShip = orig?.shipments?.[0];
      if (!p.trackingNumber && origShip?.trackingNo) {
        p.trackingNumber = origShip.trackingNo;
      }
      if (!p.courier && origShip?.carrier) {
        p.courier = origShip.carrier;
      }
      printable.push(p);
    });
    if (printable.length === 0) {
      win.close();
      notify("error", "Gagal memuat data penerima untuk label.");
      return;
    }
    printOrders(printable, "Label", win);
    if (printable.length < targets.length) {
      notify("warning", `${targets.length - printable.length} pesanan dilewati (gagal memuat data pesanan).`);
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
      if (order.account?.platform === "TIKTOK_SHOP" || order.account?.platform === "SHOPEE") {
        // Buka jendela sinkron di dalam user gesture; fetch label resmi (untuk
        // Shopee ada polling s/d ~20 dtk) jauh lebih lama dari masa user gesture,
        // sehingga window.open setelah await diblokir pop-up blocker.
        const win = openPrintWindow(`Label ${order.orderNo}`);
        if (!win) return;
        const official = await fetchOfficialLabel(order.id);
        if (official?.pdfBase64) {
          try {
            fillPrintPdfWindow(
              win,
              URL.createObjectURL(pdfBlobFromBase64(official.pdfBase64)),
              `Label ${order.orderNo}`
            );
          } catch {
            win.close();
            notify("error", "Dokumen label tidak dapat ditampilkan. Coba lagi.");
          }
          return;
        }
        if (official?.docUrl) {
          win.close();
          printShippingDocument(official.docUrl, `Label ${order.orderNo}`);
          return;
        }
        win.close();
        notify("error", official?.error ?? "Resi resmi belum tersedia. Atur pengiriman atau periksa koneksi toko, lalu coba lagi.");
        return;
      }
      // Label lokal — buka jendela dahulu, isi setelah data pesanan siap.
      const localWin = openPrintWindow(`Label ${order.orderNo}`);
      if (!localWin) return;
      const detail = await fetchOrderDetail(order.id);
      if (!detail) {
        localWin.close();
        notify("error", "Gagal memuat data penerima untuk label.");
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
      printOrders([printable], "Label", localWin);
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

  /** Apakah tab aktif adalah "Perlu Diproses" (AWAITING_SHIPMENT)? */
  const isReadyTab = currentTab.id === "ready";

  /** Buka modal pengiriman sesuai platform untuk daftar order yang sudah difilter. */
  const openShipModal = (targets: Order[]) => {
    // TikTok → modal slot handover, Shopee → ShopeeShipModal (Shopee Open API).
    // Campuran tidak diproses dalam satu aksi.
    const tiktok = targets.filter((o) => o.account?.platform === "TIKTOK_SHOP");
    const shopee = targets.filter((o) => o.account?.platform === "SHOPEE");
    if (tiktok.length > 0 && shopee.length > 0) {
      notify("warning", "Pilih order TikTok atau Shopee saja dalam satu kali Atur Pengiriman.");
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
    if (targets.length > 0) {
      notify("warning", "Atur Pengiriman hanya untuk order TikTok Shop & Shopee.");
    }
  };

  const handlePickup = () => {
    openShipModal(orders.filter((o) => selected.has(o.id) && o.status === "AWAITING_SHIPMENT"));
  };

  const handlePickupConfirm = (result: PickupShipResult) => {
    setPickupTargets(null);
    setShopeeTargets(null);
    setPickupResult(result);
  };

  const handlePickupSuccessClose = async () => {
    setPickupResult(null);
    // Refresh ringan setelah tutup — tidak blocking, tidak mengganggu UX.
    void refreshList().catch(() => { });
  };

  const handleOpenPrintLabels = (successfulOrderIds: string[]) => {
    setPickupResult(null);
    const targetOrders = orders.filter((o) => successfulOrderIds.includes(o.id));
    const shopeeOrders = targetOrders.filter((o) => o.account?.platform === "SHOPEE");
    const otherOrderIds = targetOrders.filter((o) => o.account?.platform !== "SHOPEE").map((o) => o.id);

    if (shopeeOrders.length > 0) {
      for (const o of shopeeOrders) {
        void printOrder(o, "Label");
      }
    }

    if (otherOrderIds.length > 0) {
      setPrintOrderIds(otherOrderIds);
      setShowPrintModal(true);
    }
  };

  const handlePrintDone = async () => {
    setShowPrintModal(false);
    setPrintOrderIds([]);
    await refreshList();
  };

  const handleOpenDetail = (order: Order) => {
    router.push(`/orders/detail/${order.id}`);
  };

  const busy = syncing || bgActive;

  return (
    <div className="flex min-h-full min-w-0 flex-col gap-4 p-3 font-sans sm:p-6">
      <PageHeader
        title="Kelola Pesanan"
        description="Semua pesanan dari toko Anda dalam satu tempat. Perbarui pesanan, atur pengiriman, lalu cetak label sebelum menyerahkan paket ke kurir."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void handleSync()} disabled={busy} className="gap-2">
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
              {bgActive ? "Berjalan di latar belakang..." : syncing ? "Memulai sync..." : "Perbarui Pesanan"}
            </Button>
            <Button variant="outline" onClick={() => setHistoryOpen(true)} disabled={busy} className="gap-2">
              <Calendar size={16} /> Ambil Riwayat
            </Button>
            <div className="relative" ref={moreRef}>
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Aksi lainnya" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                <MoreHorizontal size={18} />
              </Button>
              {moreOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-card py-1 shadow-lg">
                  <button
                    type="button"
                    disabled={reconciling}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50"
                    onClick={() => { setMoreOpen(false); void handleReconcile(); }}
                  >
                    <RefreshCw size={14} className={reconciling ? "animate-spin" : ""} />
                    {reconciling ? "Menyinkronkan resi..." : "Lengkapi data resi"}
                  </button>
                  <button
                    type="button"
                    disabled={orders.length === 0}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50"
                    onClick={() => { setMoreOpen(false); handleExportVisible(); }}
                  >
                    <Download size={14} /> Unduh halaman ini (CSV)
                  </button>
                </div>
              )}
            </div>
          </div>
        }
      />

      <OrderHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} busy={busy} onSubmit={handleSync} />

      {/* Progres background run (SyncRun) */}
      {bgActive && (
        <div className="flex items-center gap-2 rounded-md border border-info bg-info-subtle px-3 py-2 text-sm text-info" role="status">
          <RefreshCw size={14} className="shrink-0 animate-spin" />
          <span>
            Menarik pesanan di latar belakang: <b>{bgProgress?.fetched ?? 0} ditarik</b>, {bgProgress?.created ?? 0} baru,{" "}
            {bgProgress?.skipped ?? 0} sudah ada
            {bgProgress?.phase === "rate_wait" ? ", jeda rate limit API (wajar)" : ""}. Anda boleh berpindah menu.
          </span>
        </div>
      )}

      {/* Edukasi batas API & pola pakai */}
      {!infoDismissed && (
        <Alert className="border-warning bg-warning-subtle text-warning [&>svg]:text-warning">
          <Info size={16} className="text-warning" />
          <AlertTitle className="flex w-full items-start justify-between gap-2 text-warning">
            Tentang sinkronisasi pesanan
            <button type="button" onClick={() => setInfoDismissed(true)} className="rounded p-0.5 hover:bg-warning-subtle" aria-label="Tutup informasi">
              <X size={14} />
            </button>
          </AlertTitle>
          <AlertDescription className="space-y-1 text-warning">
            <p>Sync pertama mengambil pesanan sesuai periode toko (default 30 hari). Sync berikutnya hanya mengambil pesanan baru atau yang berubah. Untuk tanggal lebih lama, gunakan Ambil Riwayat.</p>
            <p>Untuk pekerjaan harian, buka tab Perlu Diproses dan pilih pesanan dari satu marketplace setiap kali mengatur pengiriman.</p>
            <p>Invoice dan packing list dibuat oleh Maxius. Label TikTok berasal dari marketplace; untuk resi Shopee resmi, gunakan Seller Center.</p>
          </AlertDescription>
        </Alert>
      )}

      <DataCard className="min-w-0 shrink-0" contentClassName="min-w-0 p-0">
        {/* Tab status — garis bawah, jumlah di samping label (gaya Shopee) */}
        <div className="flex items-center overflow-x-auto border-b border-border bg-card px-2 sm:px-4" role="tablist">
          {TABS.map((tab) => {
            const count = tab.statuses === null
              ? Object.values(counts).reduce((a, b) => a + b, 0)
              : tab.statuses.reduce((acc, s) => acc + (counts[s] ?? 0), 0);
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                onClick={() => handleTab(tab.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors sm:px-4 ${active ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`text-xs tabular-nums ${tab.id === "ready" ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                    ({count.toLocaleString("id-ID")})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sub-tab sebagai chip (gaya TikTok Shop) */}
        {currentSubTabs && (
          <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-card px-4 py-2.5">
            {currentSubTabs.map((sub) => {
              const subCount = sub.statuses.reduce((acc, s) => acc + (counts[s] ?? 0), 0);
              const active = activeSubTab === sub.id;
              return (
                <button
                  key={sub.id}
                  onClick={() => handleSubTab(sub.id)}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
                    }`}
                >
                  {sub.label} ({subCount.toLocaleString("id-ID")})
                </button>
              );
            })}
          </div>
        )}

        {/* Filter */}
        <div className="flex flex-col gap-3 border-b border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 min-w-0 flex-1 basis-full overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring sm:basis-auto sm:max-w-xl">
              <select
                aria-label="Jenis pencarian"
                value={searchType.id}
                onChange={(e) => handleSearchTypeChange(e.target.value)}
                className="border-r border-border bg-muted px-3 text-sm font-medium text-foreground outline-none"
              >
                {SEARCH_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
              <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={searchType.placeholder}
                  className="w-full min-w-0 bg-transparent text-sm outline-none"
                />
                <Search size={16} className="shrink-0 text-muted-foreground" />
              </div>
            </div>

            <select
              aria-label="Filter marketplace pesanan"
              value={platformFilter}
              onChange={(event) => { setPlatformFilter(event.target.value); setAccountFilter("all"); setPage(1); }}
              className={SELECT_CLASS}
            >
              <option value="all">Semua marketplace</option>
              <option value="SHOPEE">Shopee</option>
              <option value="TIKTOK_SHOP">TikTok Shop</option>
              <option value="TOKOPEDIA">Tokopedia</option>
            </select>
            <select
              aria-label="Filter toko pesanan"
              value={accountFilter}
              onChange={(event) => { setAccountFilter(event.target.value); setPage(1); }}
              className={SELECT_CLASS}
            >
              <option value="all">Semua toko</option>
              {filterOptions.accounts
                .filter((account) => platformFilter === "all" || account.platform === platformFilter)
                .map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
            <select
              aria-label="Filter kategori pesanan"
              value={categoryFilter}
              onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}
              className={SELECT_CLASS}
            >
              <option value="all">Semua kategori</option>
              {filterOptions.categories.map((category) => <option key={category}>{category}</option>)}
            </select>

            <div className="flex h-9 max-w-full items-center gap-2 rounded-md border border-border bg-card px-3">
              <Calendar size={14} className="shrink-0 text-muted-foreground" />
              <input type="date" aria-label="Tanggal mulai" value={from} onChange={(e) => handleDateChange("from", e.target.value)} className="w-[120px] bg-transparent text-sm text-foreground outline-none" />
              <span className="text-xs text-muted-foreground">s.d.</span>
              <input type="date" aria-label="Tanggal akhir" value={to} onChange={(e) => handleDateChange("to", e.target.value)} className="w-[120px] bg-transparent text-sm text-foreground outline-none" />
            </div>

            <select aria-label="Urutkan pesanan" value={sort.id} onChange={(e) => handleSortChange(e.target.value)} className={`${SELECT_CLASS} sm:ml-auto`}>
              {SORT_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
            </select>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={handleClearFilters} className="h-9 gap-1.5 text-muted-foreground">
                <Filter size={14} /> Reset filter
              </Button>
            )}
          </div>

          {(q || platformFilter !== "all" || accountFilter !== "all" || categoryFilter !== "all" || from || to) && (
            <div className="flex flex-wrap gap-2" aria-label="Filter pesanan aktif">
              {q && <button onClick={() => { setSearchInput(""); setQ(""); }} className={CHIP_CLASS}>Cari: {q} <X size={12} /></button>}
              {platformFilter !== "all" && <button onClick={() => setPlatformFilter("all")} className={CHIP_CLASS}>Marketplace: {PLATFORM[platformFilter] ?? platformFilter} <X size={12} /></button>}
              {accountFilter !== "all" && <button onClick={() => setAccountFilter("all")} className={CHIP_CLASS}>Toko: {filterOptions.accounts.find((account) => account.id === accountFilter)?.label ?? accountFilter} <X size={12} /></button>}
              {categoryFilter !== "all" && <button onClick={() => setCategoryFilter("all")} className={CHIP_CLASS}>Kategori: {categoryFilter} <X size={12} /></button>}
              {from && <button onClick={() => setFrom("")} className={CHIP_CLASS}>Mulai: {from} <X size={12} /></button>}
              {to && <button onClick={() => setTo("")} className={CHIP_CLASS}>Sampai: {to} <X size={12} /></button>}
            </div>
          )}
        </div>

        {/* Header kolom — berganti jadi bar aksi saat ada pesanan terpilih */}
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-primary/5 px-4 py-2">
            <input type="checkbox" className="h-4 w-4 rounded border-border" checked={allSelected} onChange={toggleSelectAll} aria-label="Pilih semua pesanan" />
            <span className="text-sm font-medium text-foreground">{selected.size} pesanan dipilih</span>
            {isReadyTab && (
              <Button size="sm" onClick={handlePickup} disabled={printingBulk} className="gap-1.5">
                <PackageCheck size={14} /> Atur Pengiriman
              </Button>
            )}
            <PrintDropdown
              variant="filled"
              prefixIcon={<Printer size={14} />}
              label="Cetak"
              placement="bottom-left"
              onSelect={(type) => printSelectedBulk(type)}
              items={[
                // "Label" selalu ditawarkan: order TikTok → label resmi (PDF gabungan), non-TikTok → label lokal.
                { id: "Label" as PrintType, label: "Cetak Label", description: labelMenuDescription(orders, selected) },
                { id: "Invoice" as PrintType, label: "Cetak Invoice", description: "Ringkasan transaksi dibuat oleh Maxius" },
                { id: "PackingList" as PrintType, label: "Cetak Daftar Isi Paket (Packing List)", description: "Daftar barang pesanan terpilih dibuat oleh Maxius" },
              ]}
            />
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto">Batal pilih</Button>
          </div>
        ) : (
          <div className="flex items-center border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
            <label className="flex items-center gap-3">
              <input type="checkbox" className="h-4 w-4 rounded border-border" checked={allSelected} onChange={toggleSelectAll} aria-label="Pilih semua pesanan" />
              Pilih semua pesanan pada halaman ini
            </label>
          </div>
        )}

        {/* Daftar pesanan */}
        {loading ? (
          <div className="divide-y divide-border" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse bg-muted/40" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        ) : error ? (
          <div className="p-4">
            <PageState
              variant="error"
              title="Gagal memuat pesanan"
              description={friendlyError(error)}
              details={error}
              action={
                <Button variant="outline" onClick={refreshList} className="gap-2">
                  <RefreshCw size={14} /> Coba lagi
                </Button>
              }
            />
          </div>
        ) : orders.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<PackageCheck size={40} />}
              title="Tidak ada pesanan"
              description="Belum ada pesanan pada filter ini. Coba ganti tab, ubah kata kunci, atau jalankan sync pesanan."
              action={
                <Button variant="outline" onClick={() => void handleSync()} disabled={busy} className="gap-2">
                  <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> Perbarui Pesanan
                </Button>
              }
            />
          </div>
        ) : (
          <div className="space-y-4 bg-muted/20 p-3 sm:p-4">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={toCardOrder(order)}
                checked={selected.has(order.id)}
                onToggleChecked={() => toggleSelect(order.id)}
                onSync={() => void handleSync()}
                onPrint={(type: PrintType) => printOrder(order, type)}
                onPickup={() => openShipModal([order])}
                shipping={false}
                onDetail={() => handleOpenDetail(order)}
              />
            ))}
          </div>
        )}

        {/* Footer: total & paginasi */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{total.toLocaleString("id-ID")}</span> total pesanan
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              Per halaman
              <select
                aria-label="Pesanan per halaman"
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); setSelected(new Set()); }}
                className="rounded-md border border-border bg-card px-2 py-1 text-foreground"
              >
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size.toLocaleString("id-ID")}</option>)}
              </select>
            </label>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  Sebelumnya
                </Button>
                <span className="text-xs">
                  {((page - 1) * pageSize + 1).toLocaleString("id-ID")}–{Math.min(page * pageSize, total).toLocaleString("id-ID")} dari {total.toLocaleString("id-ID")}
                </span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
                  Berikutnya
                </Button>
              </div>
            )}
          </div>
        </div>
      </DataCard>

      {/* Modal Alur Pengiriman */}
      {pickupTargets && (
        <RequestPickupModal orders={pickupTargets} onClose={() => setPickupTargets(null)} onConfirm={handlePickupConfirm} />
      )}

      {shopeeTargets && (
        <ShopeeShipModal orders={shopeeTargets} onClose={() => setShopeeTargets(null)} onConfirm={handlePickupConfirm} />
      )}

      {pickupResult && (
        <PickupSuccessModal result={pickupResult} onClose={handlePickupSuccessClose} onPrintLabels={handleOpenPrintLabels} />
      )}

      {showPrintModal && printOrderIds.length > 0 && (
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
