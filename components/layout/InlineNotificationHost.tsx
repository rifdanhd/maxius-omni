"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { APPLICATION_NOTIFICATION_EVENT, type ApplicationNotificationDetail } from "@/lib/ui/notifications";

export function InlineNotificationHost() {
  const [message, setMessage] = useState<ApplicationNotificationDetail | null>(null);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<ApplicationNotificationDetail>).detail;
      if (detail?.variant === "error") setMessage(detail);
    };
    window.addEventListener(APPLICATION_NOTIFICATION_EVENT, receive);
    return () => window.removeEventListener(APPLICATION_NOTIFICATION_EVENT, receive);
  }, []);

  if (!message) return null;

  return (
    <div data-app-inline-notification className="shrink-0 px-4 pt-3 md:px-8">
      <Feedback
        variant="error"
        title={message.notification.title}
        description={message.notification.description}
        details={message.details}
        action={
          <>
            {message.action && (
              <Button size="sm" variant="outline" onClick={() => message.action?.onClick()}>
                {message.action.label}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setMessage(null)}>
              <X aria-hidden="true" /> Tutup
            </Button>
          </>
        }
      />
    </div>
  );
}
