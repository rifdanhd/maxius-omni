"use client";

import { useState } from "react";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { Bell, CheckCheck, ChevronRight, Loader2 } from "lucide-react";
import { useNotifications } from "@/hooks/use-notifications";
import { Button } from "@/components/ui/button";
import { Feedback, PageState, feedbackIcons } from "@/components/ui/feedback";
import { feedbackStyles } from "@/lib/ui/feedback";
import { notificationGroup, relativeNotificationTime } from "@/lib/ui/notifications";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const view = useNotifications();
  const unread = view.rows.filter((item) => !item.read).length;
  const priority = { error: 0, warning: 1, info: 2 };

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><Button variant="outline" size="icon" className="relative size-11 shrink-0 rounded-full sm:size-8" aria-label={`Notifikasi${unread ? `, ${unread} belum dibaca` : ""}`}>
      <Bell className="size-4" aria-hidden="true" />
      {unread > 0 && <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground ring-2 ring-background">{unread > 9 ? "9+" : unread}</span>}
    </Button></Popover.Trigger>
    <Popover.Portal><Popover.Content data-notifications aria-label="Pusat notifikasi" align="end" sideOffset={8} collisionPadding={12} className="z-[70] flex max-h-[min(75dvh,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3"><h2 className="font-semibold">Notifikasi</h2><Button size="sm" variant="ghost" disabled={!unread} onClick={() => view.markRead()}><CheckCheck aria-hidden="true" />Tandai semua dibaca</Button></div>
      <div className="min-h-0 overflow-auto overscroll-contain">
        {view.loading ? <div role="status" className="flex items-center justify-center gap-2 p-8 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Memuat notifikasi...</div> : <>
          {view.failed.length > 0 && <Feedback variant="warning" className="m-3" title="Sebagian notifikasi belum dimuat" description={`Data ${view.failed.join(", ")} belum dapat diperbarui.`} action={<Button size="sm" variant="outline" onClick={view.refresh}>Coba lagi</Button>} />}
          {view.rows.length === 0 && view.failed.length === 0 && <PageState title="Belum ada notifikasi" description="Peringatan penting akan muncul di sini." />}
          {["Hari ini", "Kemarin", "Sebelumnya"].map((group) => {
            const rows = view.rows.filter((item) => notificationGroup(item.occurredAt ?? item.detectedAt!) === group).sort((a, b) => priority[a.severity] - priority[b.severity] || Number(Boolean(a.read)) - Number(Boolean(b.read)) || Date.parse(b.occurredAt ?? b.detectedAt!) - Date.parse(a.occurredAt ?? a.detectedAt!));
            return rows.length ? <section key={group} aria-label={group}><h3 className="sticky top-0 bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground">{group}</h3>{rows.map((item) => {
              const Icon = feedbackIcons[item.severity];
              const time = item.occurredAt ?? item.detectedAt!;
              return <Link key={item.id} href={item.href} onClick={() => { view.markRead(item.id); setOpen(false); }} className="flex items-start gap-3 border-b border-border px-4 py-3 hover:bg-muted">
                <span className={`mt-0.5 rounded-md border p-1.5 ${feedbackStyles[item.severity]}`}><Icon className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1 text-sm"><span className="block font-semibold">{item.title}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{item.description}</span><time dateTime={time} title={new Date(time).toLocaleString("id-ID")} className="mt-1 block text-xs text-muted-foreground">{!item.occurredAt && "Terdeteksi "}{relativeNotificationTime(time)}</time>{!item.read && <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-info"><span className="size-1.5 rounded-full bg-info" aria-hidden="true" />Belum dibaca</span>}</span><ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>;
            })}</section> : null;
          })}
        </>}
      </div>
      <div className="shrink-0 border-t border-border p-3 text-xs text-muted-foreground"><p>Status dibaca tersimpan di browser ini. Waktu “terdeteksi” dihitung sejak pertama kali terlihat di sini.</p>{view.more && <Link href="/inventory/mismatch" className="mt-2 block underline">Menampilkan 100 masalah sinkron terbaru. Lihat lainnya</Link>}</div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
