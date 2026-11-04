"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/utils/api-client";
import { Check, Eye, Link2, RefreshCw, Sparkles } from "lucide-react";

type Row = { accountId: string; accountLabel: string; platformProductId: string; channelSku: string; sellerSku: string | null; title: string | null; variantName: string | null; imageUrl: string | null; stock: number; bucket: "exact" | "suggested" | "review" | "new"; score: number; candidate: { id: string; sku: string; name: string; imageUrl: string | null; stock: number } | null };
type Preview = { rows: Row[]; counts: Record<Row["bucket"], number> };
type Account = { id: string; label: string; platform: string };
const labels = { exact: "Sudah cocok", suggested: "Disarankan", review: "Perlu dicek", new: "Usulkan master baru" } as const;
async function readApiResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (response.url.includes("/login")) throw new Error("Sesi login sudah berakhir. Silakan login kembali.");
    throw new Error(`Server mengembalikan halaman HTML, bukan JSON (HTTP ${response.status}). Coba muat ulang halaman.`);
  }
  const data = await response.json().catch(() => null) as T & { error?: string } | null;
  if (!data) throw new Error(`Respons server tidak valid (HTTP ${response.status}).`);
  if (!response.ok) throw new Error(data.error || `Permintaan gagal (HTTP ${response.status}).`);
  return data;
}

export function AutoMatchPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accountId, setAccountId] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const key = (row: Row) => `${row.accountId}:${row.channelSku}`;
  useEffect(() => {
    authFetch("/api/accounts").then((response) => readApiResponse<{ accounts: Account[] }>(response)).then((data) => setAccounts(data.accounts.filter((account) => account.platform === "TIKTOK_SHOP"))).catch(() => setMessage("Daftar akun marketplace belum dapat dimuat."));
  }, []);
  async function runPreview() {
    setLoading(true); setMessage(null);
    try {
      const response = await authFetch(`/api/inventory/auto-match${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`);
      const data = await readApiResponse<Preview>(response);
      setPreview(data); setSelected(Object.fromEntries((data.rows as Row[]).filter((row) => row.bucket === "exact").map((row) => [key(row), true])));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Preview gagal."); } finally { setLoading(false); }
  }
  async function apply() {
    if (!preview) return;
    const decisions = preview.rows.filter((row) => selected[key(row)]).map((row) => row.bucket === "new"
      ? { accountId: row.accountId, channelSku: row.channelSku, createMaster: true, masterName: row.title ?? row.channelSku, sku: row.sellerSku?.trim() || `AUTO-${row.channelSku.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase()}`, imageUrl: row.imageUrl }
      : { accountId: row.accountId, channelSku: row.channelSku, variantId: row.candidate?.id });
    if (!decisions.length) return setMessage("Pilih minimal satu baris.");
    setSaving(true); setMessage(null);
    try {
      const response = await authFetch("/api/inventory/auto-match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisions }) });
      const data = await readApiResponse<{ mapped: number; created: number }>(response);
      setMessage(`${data.mapped} mapping tersimpan, ${data.created} master baru dibuat.`); await runPreview();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Penyimpanan gagal."); } finally { setSaving(false); }
  }
  return <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 md:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-base font-semibold"><Sparkles size={17} /> Auto-match lintas toko</h2><p className="mt-1 text-xs text-muted-foreground">Preview read-only: SKU seller, nama, warna, dan ukuran dinormalisasi. Hanya baris yang Anda pilih yang disimpan.</p></div>
      <div className="flex flex-wrap gap-2"><select aria-label="Pilih akun TikTok" value={accountId} onChange={(event) => setAccountId(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-xs"><option value="">Pilih satu akun TikTok…</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select><Button size="sm" variant="outline" onClick={runPreview} disabled={loading || !accountId}>{loading ? <RefreshCw className="animate-spin" size={14} /> : <Eye size={14} />} Preview</Button></div>
    </div>
    {message && <p className="mt-3 rounded-md bg-background px-3 py-2 text-xs">{message}</p>}
    {preview && <>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">{(Object.keys(labels) as Row["bucket"][]).map((bucket) => <div key={bucket} className="rounded-lg bg-background px-3 py-2"><p className="text-[11px] text-muted-foreground">{labels[bucket]}</p><p className="text-lg font-bold">{preview.counts[bucket]}</p></div>)}</div>
      <div className="mt-4 flex justify-end"><Button size="sm" onClick={apply} disabled={saving}><Link2 size={14} /> {saving ? "Menyimpan..." : `Setujui pilihan (${Object.values(selected).filter(Boolean).length})`}</Button></div>
      <div className="mt-3 space-y-2">{preview.rows.map((row) => <label key={key(row)} className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border bg-background p-3 text-sm"><input type="checkbox" checked={!!selected[key(row)]} onChange={(event) => setSelected((current) => ({ ...current, [key(row)]: event.target.checked }))} /><div className="flex items-center gap-2"><img src={row.imageUrl || "/placeholder-product.svg"} alt="" className="size-10 rounded object-cover" /><div><p className="font-medium">{row.title || "Produk marketplace"}</p><p className="font-mono text-xs text-muted-foreground">{row.sellerSku || row.channelSku} · {row.accountLabel}</p></div></div><span className="text-muted-foreground">→</span><div className="flex items-center gap-2">{row.candidate?.imageUrl && <img src={row.candidate.imageUrl} alt="" className="size-10 rounded object-cover" />}<div><p className="font-medium">{row.candidate ? `${row.candidate.name} / ${row.candidate.sku}` : "Buat master baru"}</p><p className="text-xs text-muted-foreground">{labels[row.bucket]} · skor {(row.score * 100).toFixed(0)}%</p></div></div><Check className="ml-auto text-primary" size={16} /></label>)}</div>
    </>}
  </section>;
}
