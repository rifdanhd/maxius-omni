"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { feedbackIcons, TechnicalDetails } from "@/components/ui/feedback";
import { feedbackStyles, feedbackTitles, friendlyError, type FeedbackVariant } from "@/lib/ui/feedback";

type Options = { title?: string; details?: unknown; action?: { label: string; onClick: () => void }; content?: ReactNode };
const active: Array<string | number> = [];
const forget = (id: string | number) => { const index = active.indexOf(id); if (index !== -1) active.splice(index, 1); };

export function notify(variant: FeedbackVariant, message: string, options: Options = {}) {
  if (typeof window === "undefined") return;
  while (active.length >= 3) toast.dismiss(active.shift());
  const Icon = feedbackIcons[variant];
  const humanMessage = message.replace(/\bsync\b/gi, "sinkron").replace(/\bimport\b/gi, "impor");
  const summary = humanMessage.split("\n")[0];
  const display = variant === "error" ? friendlyError(message) : humanMessage.length > 240 ? `${summary.slice(0, 200)}…` : summary;
  const details = options.details ?? (display !== message ? message : undefined);
  const id = toast.custom((toastId) => <div data-app-toast={variant} role={variant === "error" ? "alert" : "status"} aria-atomic="true" className={`flex w-full items-start gap-3 rounded-lg border p-4 shadow-lg ${feedbackStyles[variant]}`}>
    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1 text-sm">
      <p className="font-semibold">{options.title ?? feedbackTitles[variant]}</p>
      <p className="mt-1 break-words">{display}</p>
      {options.content}
      <TechnicalDetails value={details} />
      {options.action && <Button variant="outline" size="sm" className="mt-3" onClick={() => { toast.dismiss(toastId); forget(toastId); options.action?.onClick(); }}>{options.action.label}</Button>}
    </div>
    <Button variant="ghost" size="icon" className="-mr-2 -mt-2 size-9 shrink-0" aria-label="Tutup notifikasi" onClick={() => { toast.dismiss(toastId); forget(toastId); }}><X className="size-4" aria-hidden="true" /></Button>
  </div>, { duration: variant === "error" ? Infinity : 5000, onDismiss: (item) => forget(item.id), onAutoClose: (item) => forget(item.id) });
  active.push(id);
  return id;
}
