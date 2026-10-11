"use client";

import type { ReactNode } from "react";
import { CheckCircle2, AlertTriangle, CircleAlert, Info, CircleMinus, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedbackStyles, friendlyError, safeDetails, type FeedbackVariant } from "@/lib/ui/feedback";

export const feedbackIcons = { success: CheckCircle2, warning: AlertTriangle, error: CircleAlert, info: Info, neutral: CircleMinus };

export function TechnicalDetails({ value }: { value?: unknown }) {
  if (!value) return null;
  return <details className="mt-2 text-xs text-muted-foreground">
    <summary className="w-fit cursor-pointer rounded-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">Lihat detail</summary>
    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground">{safeDetails(value)}</pre>
  </details>;
}

type FeedbackProps = {
  variant?: FeedbackVariant;
  title: string;
  description?: ReactNode;
  details?: unknown;
  action?: ReactNode;
  className?: string;
};

export function Feedback({ variant = "info", title, description, details, action, className }: FeedbackProps) {
  const Icon = feedbackIcons[variant];
  return <div data-feedback={variant} role={variant === "error" ? "alert" : "status"} aria-atomic="true" className={cn("flex min-w-0 items-start gap-3 rounded-lg border p-4 text-sm", feedbackStyles[variant], className)}>
    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="font-semibold">{title}</p>
      {description && <div className="mt-1 break-words">{description}</div>}
      <TechnicalDetails value={details} />
      {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </div>
  </div>;
}

export function ErrorFeedback({ error, title = "Tindakan belum berhasil", action, className }: { error: unknown; title?: string; action?: ReactNode; className?: string }) {
  const message = friendlyError(error);
  return <Feedback variant="error" title={title} description={message} details={message !== String(error) ? error : undefined} action={action} className={className} />;
}

export function FormError({ children, id, className }: { children?: ReactNode; id?: string; className?: string }) {
  if (!children) return null;
  const message = typeof children === "string" ? friendlyError(children, "Periksa isian, lalu coba lagi.") : children;
  return <div id={id} role="alert" className={cn("mt-2 text-xs text-destructive", className)}><p className="flex items-start gap-1.5"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>{message}</span></p>{message !== children && <TechnicalDetails value={children} />}</div>;
}

export function PageState({ variant = "neutral", title, description, details, action, className }: FeedbackProps) {
  const Icon = variant === "neutral" ? PackageOpen : feedbackIcons[variant];
  return <div role={variant === "error" ? "alert" : "status"} data-page-state={variant} className={cn("mx-auto flex max-w-xl flex-col items-center gap-3 p-6 text-center text-sm", className)}>
    <span className={cn("rounded-full border p-3", feedbackStyles[variant])}><Icon className="size-6" aria-hidden="true" /></span>
    <p className="font-semibold text-foreground">{title}</p>
    {description && <div className="text-muted-foreground">{description}</div>}
    <TechnicalDetails value={details} />
    {action && <div className="flex flex-wrap justify-center gap-2">{action}</div>}
  </div>;
}
