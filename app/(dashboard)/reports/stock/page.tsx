"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/utils/api-client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type StockRow = {
  variantId: string;
  sku: string;
  variantName: string | null;
  productName: string;
  stock: number;
  safetyStock: number;
  orderedQty: number;
  available: number;
  minStockResolved: number | null;
};

type Counts = { all: number; empty: number; low: number; oversells: number };

function rowStatus(row: StockRow): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (row.stock - row.safetyStock <= 0) return { label: "Habis", variant: "destructive" };
  if (row.minStockResolved !== null && row.stock <= row.minStockResolved)
    return { label: "Perhatian", variant: "secondary" };
  return { label: "Aman", variant: "default" };
}

export default function StockReportPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/inventory/stock?tab=all&limit=200");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { rows?: StockRow[]; counts?: Counts };
        if (cancelled) return;
        setRows(data.rows ?? []);
        setCounts(data.counts ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Gagal memuat laporan stok.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = [
    { title: "Total Varian", value: counts?.all ?? null },
    { title: "Stok Kritis", value: counts?.low ?? null, danger: false },
    { title: "Habis (≤ Safety)", value: counts?.empty ?? null },
    { title: "Oversell Tertunda", value: counts?.oversells ?? null },
  ];

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Laporan Stok</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rekap stok sentral seluruh varian dalam brand aktif
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-900">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summary.map((s) => (
          <Card key={s.title}>
            <CardContent className="p-6">
              <p className="text-sm font-medium text-muted-foreground">{s.title}</p>
              <p className="text-2xl font-bold mt-2">
                {s.value === null ? "—" : s.value.toLocaleString("id-ID")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detail Varian</CardTitle>
          <CardDescription>
            {rows.length > 0
              ? `${rows.length} varian ditampilkan (urut nama produk${(counts?.all ?? 0) > rows.length ? `, dari ${counts?.all} total — batas 200 baris per halaman` : ""})`
              : "Tidak ada varian"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Belum ada varian stok di brand ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left font-semibold">SKU</th>
                    <th className="px-4 py-3 text-left font-semibold">Produk</th>
                    <th className="px-4 py-3 text-left font-semibold">Varian</th>
                    <th className="px-4 py-3 text-right font-semibold">Fisik</th>
                    <th className="px-4 py-3 text-right font-semibold">Safety</th>
                    <th className="px-4 py-3 text-right font-semibold" title="stock − safetyStock, dibatasi ≥ 0">
                      Tersedia
                    </th>
                    <th className="px-4 py-3 text-right font-semibold" title="Qty terpesan yang memotong stok">
                      Terpesan
                    </th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const st = rowStatus(row);
                    return (
                      <tr key={row.variantId} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="px-4 py-3 font-mono text-xs">{row.sku}</td>
                        <td className="px-4 py-3">{row.productName}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.variantName ?? "—"}</td>
                        <td className="px-4 py-3 text-right">{row.stock.toLocaleString("id-ID")}</td>
                        <td className="px-4 py-3 text-right">{row.safetyStock.toLocaleString("id-ID")}</td>
                        <td className="px-4 py-3 text-right font-medium">
                          {row.available.toLocaleString("id-ID")}
                        </td>
                        <td className="px-4 py-3 text-right">{row.orderedQty.toLocaleString("id-ID")}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant={st.variant} className="text-xs">
                            {st.label}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
