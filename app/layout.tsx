import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/context/theme-provider";
import { AppToaster } from "@/components/ui/app-toaster";

export const metadata: Metadata = {
  title: "Maxius.id",
  description: "Platform omnichannel stock sync — Maxius Indonesia",
  icons: {
    icon: "/Logo/Logo_backroundNO.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          {children}
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
