"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export type OrderHistoryRange = { from: string; to: string };

export default function OrderHistoryDialog({
  open, onOpenChange, busy, onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: (range: OrderHistoryRange) => Promise<boolean>;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ambil Riwayat Pesanan</DialogTitle>
          <DialogDescription>
            Pilih tanggal pesanan yang ingin diambil dari semua toko terhubung.
            Tanggal akhir ikut disertakan. Proses berjalan di latar belakang.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            if (!from || !to || from > to || to > today) {
              setError("Pilih rentang tanggal yang berurutan dan tidak melebihi hari ini.");
              return;
            }
            const start = new Date(`${from}T00:00:00`);
            const end = new Date(`${to}T00:00:00`);
            end.setDate(end.getDate() + 1);
            const accepted = await onSubmit({
              from: start.toISOString(),
              to: new Date(Math.min(end.getTime(), Date.now())).toISOString(),
            });
            if (accepted) onOpenChange(false);
            else setError("Riwayat belum dapat dimulai. Periksa pesan sinkronisasi di halaman pesanan.");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium" htmlFor="history-from">
              <span>Dari tanggal</span>
              <input id="history-from" type="date" required value={from} max={to || today}
                disabled={busy} onChange={(event) => setFrom(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3" />
            </label>
            <label className="space-y-2 text-sm font-medium" htmlFor="history-to">
              <span>Sampai tanggal</span>
              <input id="history-to" type="date" required value={to} min={from || undefined} max={today}
                disabled={busy} onChange={(event) => setTo(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3" />
            </label>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type="submit" disabled={busy || !from || !to}>
              {busy ? "Memulai..." : "Ambil Riwayat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
