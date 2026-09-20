"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/context/theme-provider";

export function AppToaster() {
  const { theme = "system" } = useTheme();

  return (
    <Toaster
      theme={theme as "light" | "dark" | "system"}
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
