"use client";

import { useEffect, useState } from "react";
import {
  Package,
  ShoppingCart,
  AlertTriangle,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/utils/api-client";

type Summary = {
  accountsConnected: number;
  activeSku: number;
  criticalStock: number;
  newOrders: number;
  readyToShip: number;
  completedOrders: number;
  oversell: number;
};

type AnalyticsData = {
  window: { current: { start: string; end: string }; previous: { start: string; end: string } };
  metrics: {
    revenue: { current: number; previous: number; changePct: number | null; orders: number };
    units: { current: number; previous: number; changePct: number | null };
    completedRevenue: { current: number; previous: number; changePct: number | null };
    completedOrders: { current: number; previous: number; changePct: number | null };
  };
  chart: { date: string; current: number | null; previous: number | null }[];
  topStores: { id: string; label: string; platform: string; value: number; units: number }[];
  topProducts: { key: string; name: string; sku: string | null; channelSku: string | null; qty: number; value: number }[];
};

type OpsKpi = {
  centralStock: { variantCount: number; totalUnits: number; totalSellable: number };
  lowStock: { count: number; top: Array<{ variantId: string; sku: string; variantName: string | null; productName: string; stock: number; safetyStock: number; sellable: number; severity: "low" | "out" }> };
  mismatch: { total: number; failed: number; pendingRetry: number };
  syncErrors: { count7d: number; byKind: Array<{ kind: string; count: number }> };
};

type RecentOrder = {
  id: string;
  customer: string;
  product: string;
  status: string;
  amount: number;
  date: string;
};

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

function formatRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

function trendLabel(pct: number | null): string | undefined {
  if (pct === null) return undefined;
  return `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}%`;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary>({ accountsConnected: 0, activeSku: 0, criticalStock: 0, newOrders: 0, readyToShip: 0, completedOrders: 0, oversell: 0 });
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [opsKpi, setOpsKpi] = useState<OpsKpi | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAll() {
      try {
        const token = localStorage.getItem("token");
        const headers = { Authorization: `Bearer ${token}` };
        const [summaryRes, analyticsRes, kpiRes, ordersRes] = await Promise.all([
          authFetch("/api/summary", { headers }),
          authFetch("/api/analytics", { headers }),
          authFetch("/api/dashboard/kpi", { headers }),
          authFetch("/api/orders/recent", { headers }),
        ]);
        if (summaryRes.ok) setSummary(await summaryRes.json());
        if (analyticsRes.ok) setAnalytics(await analyticsRes.json());
        if (kpiRes.ok) setOpsKpi(await kpiRes.json());
        if (ordersRes.ok) setRecentOrders(await ordersRes.json());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-16" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const m = analytics?.metrics;
  const chartData = analytics?.chart ?? [];

  const stats = [
    { title: "Total Orders", value: summary.newOrders.toString(), icon: ShoppingCart, change: m ? trendLabel(m.revenue.changePct) : undefined, up: m ? (m.revenue.changePct ?? 0) >= 0 : true },
    { title: "Active SKUs", value: summary.activeSku.toString(), icon: Package, change: undefined, up: true },
    { title: "Stock Alerts", value: summary.criticalStock.toString(), icon: AlertTriangle, change: undefined, up: false },
    { title: "Revenue", value: m ? formatRp(m.revenue.current) : "Rp0", icon: TrendingUp, change: m ? trendLabel(m.revenue.changePct) : undefined, up: m ? (m.revenue.changePct ?? 0) >= 0 : true },
  ];

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your marketplace performance</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                  <p className="text-2xl font-bold mt-2">{stat.value}</p>
                </div>
                <stat.icon className="h-8 w-8 text-muted-foreground/50" />
              </div>
              {stat.change && (
                <div className="flex items-center gap-1 mt-2">
                  {stat.up ? <ArrowUpRight className="h-4 w-4 text-green-600" /> : <ArrowDownRight className="h-4 w-4 text-red-600" />}
                  <Badge variant={stat.up ? "default" : "destructive"} className="text-xs">{stat.change}</Badge>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue Analysis</CardTitle>
            <CardDescription>Sales performance over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#9ca3af", fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ca3af", fontSize: 12 }} dx={-10} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} />
                  <Legend iconType="plainline" verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: "20px", fontSize: "12px" }} />
                  <Bar dataKey="current" name="Periode Sekarang" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="previous" name="Periode Sebelumnya" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stock Alerts</CardTitle>
            <CardDescription>Critical inventory items</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {opsKpi && opsKpi.lowStock.top.slice(0, 5).map((item, i) => (
              <div key={item.variantId} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  <div>
                    <p className="text-sm font-medium">{item.productName}</p>
                    <p className="text-xs text-muted-foreground">{item.variantName ?? item.sku}</p>
                  </div>
                </div>
                <Badge variant="destructive" className="text-xs">{item.stock} left</Badge>
              </div>
            ))}
            {(!opsKpi || opsKpi.lowStock.top.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">No alerts</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Orders</CardTitle>
          <CardDescription>Latest transactions across all marketplaces</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentOrders.slice(0, 10).map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.id}</TableCell>
                  <TableCell>{order.customer}</TableCell>
                  <TableCell>{order.product}</TableCell>
                  <TableCell>
                    <Badge variant={order.status === "completed" ? "default" : order.status === "processing" ? "secondary" : "outline"}>
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatRp(order.amount)}</TableCell>
                  <TableCell className="text-muted-foreground">{order.date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {recentOrders.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">No recent orders</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
