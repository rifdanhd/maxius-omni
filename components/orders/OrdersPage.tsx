"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Mail, ChevronDown, Search, Filter, Calendar, RefreshCw, Printer } from "lucide-react";
import OrderCard, { type PrintType } from "./OrderCard";
import { printOrders, type PrintableOrder } from "./printOrders";
import { ordersToCsv, downloadCsv, type ExportOrderRow } from "./exportOrders";

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

const SORT_OPTIONS: { id: string; label: string; field: "createTime" | "amount"; dir: "desc" | "asc" }[] = [
  { id: "newest", label: "Terbaru", field: "createTime", dir: "desc" },
  { id: "oldest", label: "Terlama", field: "createTime", dir: "asc" },
  { id: "amount_desc", label: "Total Tertinggi", field: "amount", dir: "desc" },
  { id: "amount_asc", label: "Total Terendah", field: "amount", dir: "asc" },
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
    courier: "-",
    trackingNumber: "-",
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
  sort: (typeof SORT_OPTIONS)[number];
  from: string;
  to: string;
}) {
  const params = new URLSearchParams();
  params.set("page", String(input.page));
  params.set("pageSize", String(PAGE_SIZE));
  const statuses = input.tab.statuses;
  if (statuses !== null) params.set("status", statuses.join(","));
  if (input.q.trim()) params.set("q", input.q.trim());
  params.set("sort", input.sort.field);
  params.set("dir", input.sort.dir);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  return params.toString();
}

export default function OrdersPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(SORT_OPTIONS[0]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const currentTab = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  const fetchOrders = useCallback(
    async (opts: { page: number; tab: typeof currentTab; q: string; sort: typeof sort; from: string; to: string }) => {
      const token = localStorage.getItem("token");
      const query = buildQueryParams(opts);
      const res = await fetch(`/api/orders?${query}`, {
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
        const data = await fetchOrders({ page, tab: currentTab, q, sort, from, to });
        if (cancelled) return;
        setOrders(data.orders ?? []);
        setTotal(data.total ?? 0);
        setPageCount(data.pageCount ?? 1);
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
  }, [page, currentTab, q, sort, from, to, fetchOrders]);

  const handleTab = (id: string) => {
    setActiveTab(id);
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
      const res = await fetch("/api/orders/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Gagal sync (${res.status})`);
        return;
      }
      const result = await fetchOrders({ page, tab: currentTab, q, sort, from, to });
      setOrders(result.orders ?? []);
      setTotal(result.total ?? 0);
      setPageCount(result.pageCount ?? 1);
      setSelected(new Set());
      const detail = data.results
        ?.map((r: { label?: string; created?: number; skipped?: number; error?: string }) =>
          r.error
            ? `${r.label}: ${r.error}`
            : `${r.label}: +${r.created ?? 0} baru, ${r.skipped ?? 0} sudah ada`
        )
        .join("\n");
      alert(`Sync selesai — ${data.synced ?? 0} order baru, ${data.skipped ?? 0} sudah ada.${detail ? `\n\n${detail}` : ""}`);
    } catch (e) {
      console.error(e);
      setError("Terjadi kesalahan saat sync.");
    } finally {
      setSyncing(false);
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

  const printSelectedBulk = (type: PrintType) => {
    const targets = orders.filter((o) => selected.has(o.id));
    if (targets.length === 0) return;
    printOrders(targets.map(toPrintable), type);
  };

  const printOrder = (order: Order, type: PrintType) => {
    printOrders([toPrintable(order)], type);
  };

  const handleExportVisible = () => {
    if (orders.length === 0) return;
    const csv = ordersToCsv(orders.map(toExportRow));
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`pesanan-${date}.csv`, csv);
  };

  const handleOpenDetail = (order: Order) => {
    router.push(`/orders/detail/${order.id}`);
  };

  const allSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));

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
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTab(tab.id)}
              className={`whitespace-nowrap px-4 py-4 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter Row */}
        <div className="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden h-10 flex-1 max-w-xl">
            <button className="px-3 bg-gray-50 border-r border-gray-200 text-sm text-gray-600 flex items-center gap-1 hover:bg-gray-100 min-w-[140px]">
              Keyword Pes... <ChevronDown size={14} className="ml-auto" />
            </button>
            <div className="flex-1 flex items-center px-3 gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Cari nomor pesanan, pembeli"
                className="w-full text-sm outline-none bg-transparent"
              />
              <Search size={16} className="text-gray-400 shrink-0" />
            </div>
          </div>

          <div className="relative group">
            <button className="h-10 px-4 border border-gray-200 rounded-lg text-sm text-gray-500 bg-white flex items-center gap-2 hover:bg-gray-50 min-w-[140px] justify-between">
              {sort.label} <ChevronDown size={14} />
            </button>
            <div className="hidden group-hover:block absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleSortChange(opt)}
                  className={`w-full text-left px-4 py-2 text-sm ${
                    sort.id === opt.id ? "font-semibold text-indigo-600" : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
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
              <div className="relative group flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold hover:bg-indigo-700">
                  <Printer size={14} /> Cetak ({selected.size}) <ChevronDown size={14} />
                </button>
                <div className="hidden group-hover:block absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                  <button
                    onClick={() => printSelectedBulk("Label")}
                    className="w-full text-left px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cetak Label
                  </button>
                  <button
                    onClick={() => printSelectedBulk("Invoice")}
                    className="w-full text-left px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cetak Invoice
                  </button>
                  <button
                    onClick={() => printSelectedBulk("PackingList")}
                    className="w-full text-left px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cetak Packing List
                  </button>
                </div>
              </div>
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
                onDetail={() => handleOpenDetail(order)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}