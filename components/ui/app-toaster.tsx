"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/context/theme-provider";

export function AppToaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Toaster
      theme={resolvedTheme}
      position="top-right"
      visibleToasts={3}
      expand
      duration={5000}
      offset={{ top: 72, right: 16 }}
      mobileOffset={{ top: 72, left: 12, right: 12 }}
      containerAriaLabel="Notifikasi aplikasi"
      className="toaster group [&_div[data-content]]:w-full"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
    />
  );
}
