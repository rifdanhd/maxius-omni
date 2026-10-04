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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t="system";try{var s=localStorage.getItem("vite-ui-theme");if(s==="light"||s==="dark"||s==="system")t=s}catch(e){}var r=t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;var h=document.documentElement;h.classList.remove("light","dark");h.classList.add(r);h.style.colorScheme=r})()`,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          {children}
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
