import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
