"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Mail, ChevronDown, Search, Filter, Calendar, RefreshCw, Printer } from "lucide-react";
import OrderCard, { type PrintType } from "./OrderCard";
import PrintDropdown from "./PrintDropdown";
import { printOrders, printShippingDocument, printPdfWindow, pdfBlobFromBase64, type PrintableOrder } from "./printOrders";
import { ordersToCsv, downloadCsv, type ExportOrderRow } from "./exportOrders";
import RequestPickupModal, { type PickupShipResult, type RequestPickupOrder } from "./RequestPickupModal";
import PickupSuccessModal from "./PickupSuccessModal";
import PrintMethodModal from "./PrintMethodModal";
import { PackageCheck } from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";

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
): Promise<{ docUrl: string; trackingNumber: string | null } | null> {
  try {
    const token = localStorage.getItem("token");
    const res = await authFetch(`/api/orders/${id}/label`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.docUrl ? { docUrl: data.docUrl, trackingNumber: data.trackingNumber ?? null } : null;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printingBulk, setPrintingBulk] = useState(false);
  const [pickupTargets, setPickupTargets] = useState<RequestPickupOrder[] | null>(null);
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
      const result = await fetchOrders({ page, tab: currentTab, subTab: currentSubTab, q, searchType: searchType.id, sort, from, to });
      setOrders(result.orders ?? []);
      setTotal(result.total ?? 0);
      setPageCount(result.pageCount ?? 1);
      setSelected(new Set());
      const reconcileNote = (data.results as { reconciled?: number }[] | undefined)
        ?.map((r) => r.reconciled ?? 0)
        .reduce((a, b) => a + b, 0);
      const detail = data.results
        ?.map((r: { label?: string; created?: number; skipped?: number; reconciled?: number; error?: string }) =>
          r.error
            ? `${r.label}: ${r.error}`
            : `${r.label}: +${r.created ?? 0} baru, ${r.skipped ?? 0} sudah ada${(r.reconciled ?? 0) > 0 ? `, ${r.reconciled} resi dilengkapi` : ""}`
        )
        .join("\n");
      alert(`Sync selesai — ${data.synced ?? 0} order baru, ${data.skipped ?? 0} sudah ada.${reconcileNote ? `\n\nResi backfill: ${reconcileNote} paket diperbarui.` : ""}${detail ? `\n\n${detail}` : ""}`);
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

  const printSelectedBulk = async (type: PrintType) => {
    const targets = orders.filter((o) => selected.has(o.id));
    if (targets.length === 0) return;
    if (type === "Label") {
      // Label resmi digabung jadi 1 PDF multi-halaman di server (TikTok tidak
      // punya endpoint batch utk shipping document). Order yang belum punya
      // label resmi (belum di-ship / tidak punya paket) dilewati & dilaporkan.
      await printSelectedBulkLabel(targets);
      return;
    }
    printOrders(targets.map(toPrintable), type);
  };

  const printOrder = async (order: Order, type: PrintType) => {
    if (type === "Label") {
      // Utamakan label resmi TikTok (identik dengan Seller Center).
      const official = await fetchOfficialLabel(order.id);
      if (official?.docUrl) {
        printShippingDocument(official.docUrl, `Label ${order.orderNo}`);
        return;
      }
      const detail = await fetchOrderDetail(order.id);
      if (!detail) {
        alert("Gagal memuat data penerima untuk label.");
        return;
      }
      printOrders([toPrintableFromDetail(detail)], "Label");
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
    const targets = orders
      .filter((o) => selected.has(o.id) && o.status === "AWAITING_SHIPMENT")
      .map((o) => ({
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
      }));
    if (targets.length === 0) return;
    setPickupTargets(targets);
  };

  const handlePickupConfirm = (result: PickupShipResult) => {
    setPickupTargets(null);
    setPickupResult(result);
  };

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
    <div className="p-8 font-sans h-full flex flex-col">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pesanan</h1>
        <div className="flex items-center gap-3">
          <button className="w-10 h-10 border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-50 bg-white">
            <Archive size={18} />
          </button>
          <button className="w-10 h-10 border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-50 bg-white">
            <Mail size={18} />
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Menyinkronkan..." : "Sync Pesanan"}
          </button>
          <button
            onClick={handleReconcile}
            disabled={reconciling}
            className="px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={16} className={reconciling ? "animate-spin" : ""} />
            {reconciling ? "Menyinkronkan Resi..." : "Sync Resi"}
          </button>
          <button
            onClick={handleExportVisible}
            className="px-4 py-2 border border-gray-200 rounded-lg flex items-center gap-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 bg-white"
          >
            Unduh CSV <ChevronDown size={16} />
          </button>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white border border-gray-200 rounded-xl flex-1 flex flex-col overflow-hidden shadow-sm">

        {/* Tabs */}
        <div className="flex items-center overflow-x-auto border-b border-gray-200 px-4">
          {TABS.map((tab) => {
            // Hitung jumlah pesanan dari counts
            const count = tab.statuses === null
              ? Object.values(counts).reduce((a, b) => a + b, 0)
              : (tab.statuses ?? []).reduce((acc, s) => acc + (counts[s] ?? 0), 0);
            return (
              <button
                key={tab.id}
                onClick={() => handleTab(tab.id)}
                className={`whitespace-nowrap px-4 py-4 text-sm font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                  activeTab === tab.id
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.id ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sub-Tabs (hanya untuk tab tertentu) */}
        {currentSubTabs && (
          <div className="flex items-center gap-0 border-b border-gray-100 px-6 bg-gray-50/50">
            {currentSubTabs.map((sub) => {
              const subCount = sub.id === "all"
                ? (currentTab.statuses ?? []).reduce((acc, s) => acc + (counts[s] ?? 0), 0)
                : sub.statuses.reduce((acc, s) => acc + (counts[s] ?? 0), 0);
              return (
                <button
                  key={sub.id}
                  onClick={() => handleSubTab(sub.id)}
                  className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                    activeSubTab === sub.id
                      ? "border-indigo-600 text-indigo-700"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {sub.label}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    activeSubTab === sub.id ? "bg-indigo-100 text-indigo-600" : "bg-gray-200 text-gray-500"
                  }`}>
                    {subCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Filter Row */}
        <div className="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="flex bg-white border border-gray-200 rounded-lg h-10 flex-1 max-w-xl relative">
            {/* Keyword type dropdown */}
            <div className="relative" ref={searchTypeRef}>
              <button
                onClick={() => setSearchTypeOpen((v) => !v)}
                className="h-full px-3 bg-gray-50 border-r border-gray-200 text-sm text-gray-700 font-medium flex items-center gap-1.5 hover:bg-gray-100 min-w-[130px] rounded-l-lg"
              >
                <span>{searchType.label}</span>
                <ChevronDown size={13} className="ml-auto text-gray-400" />
              </button>
              {searchTypeOpen && (
                <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1.5">
                  {SEARCH_TYPES.map((type) => (
                    <button
                      key={type.id}
                      onClick={() => { setSearchType(type); setSearchTypeOpen(false); setSearchInput(""); setQ(""); }}
                      className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 ${
                        searchType.id === type.id
                          ? "font-bold text-indigo-600"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {type.label}
                    </button>
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
                  ? "border-indigo-500 text-indigo-700 bg-indigo-50/70 ring-2 ring-indigo-500/15"
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
                        ? "font-semibold text-indigo-600 bg-indigo-50"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {sort.id === opt.id && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />}
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
            <button
              onClick={handleClearFilters}
              className="h-10 px-4 border border-gray-300 rounded-lg text-sm font-semibold text-gray-600 bg-white flex items-center gap-2 hover:bg-gray-50"
            >
              <Filter size={16} /> Reset
            </button>
          )}
        </div>

        {/* Bulk Action & Pagination */}
        <div className="px-4 py-3 bg-gray-50/50 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
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
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 rounded-md text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 shadow-xs transition-colors"
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
                    { id: "Label", label: "Cetak Label", description: "Label resmi TikTok gabungan (PDF)" },
                    { id: "Invoice", label: "Cetak Invoice", description: "Faktur pesanan terpilih" },
                    { id: "PackingList", label: "Cetak Packing List", description: "Daftar packing pesanan terpilih" },
                  ]}
                />
              </>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span className="font-semibold text-indigo-600">{total}</span>
            <span>Total pesanan</span>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-2 py-1 border border-gray-200 rounded-md text-xs font-semibold disabled:opacity-40 enabled:hover:bg-gray-100 bg-white"
                >
                  Sebelumnya
                </button>
                <span className="px-2 text-xs">
                  Hal {page} / {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                  className="px-2 py-1 border border-gray-200 rounded-md text-xs font-semibold disabled:opacity-40 enabled:hover:bg-gray-100 bg-white"
                >
                  Berikutnya
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Orders List */}
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-500">Memuat pesanan...</div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-red-600">{error}</div>
          ) : orders.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">Tidak ada pesanan.</div>
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
                  // Single-order pickup dari kartu — buka modal dengan order ini saja.
                  const o = order;
                  setPickupTargets([{
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
                  }]);
                }}
                shipping={false}
                onDetail={() => handleOpenDetail(order)}
              />
            ))
          )}
        </div>
      </div>

      {/* Modal Alur Pengiriman */}
      {pickupTargets && (
        <RequestPickupModal
          orders={pickupTargets}
          onClose={() => setPickupTargets(null)}
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