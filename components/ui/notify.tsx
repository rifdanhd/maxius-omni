"use client";

import type { ReactNode } from "react";
import { feedbackTitles, friendlyError, type FeedbackVariant } from "@/lib/ui/feedback";
import { APPLICATION_NOTIFICATION_EVENT, type ApplicationNotificationDetail } from "@/lib/ui/notifications";

type Options = { title?: string; details?: unknown; action?: { label: string; onClick: () => void }; content?: ReactNode };
export function notify(variant: FeedbackVariant, message: string, options: Options = {}) {
  if (typeof window === "undefined") return;
  const humanMessage = message.replace(/\bsync\b/gi, "sinkron").replace(/\bimport\b/gi, "impor");
  const summary = humanMessage.split("\n")[0];
  const display = variant === "error" ? friendlyError(message) : humanMessage.length > 240 ? `${summary.slice(0, 200)}…` : summary;
  const details = options.details ?? (display !== message ? message : undefined);
  const occurredAt = new Date().toISOString();
  const id = `local:${occurredAt}:${crypto.randomUUID()}`;
  const detail: ApplicationNotificationDetail = {
    variant,
    details,
    action: options.action,
    notification: {
      id,
      source: "local",
      fingerprint: `${variant}:${id}`,
      severity: variant === "error" ? "error" : variant === "warning" ? "warning" : "info",
      title: options.title ?? feedbackTitles[variant],
      description: display,
      href: `${window.location.pathname}${window.location.search}`,
      occurredAt,
    },
  };
  window.dispatchEvent(new CustomEvent(APPLICATION_NOTIFICATION_EVENT, { detail }));
  return id;
}
