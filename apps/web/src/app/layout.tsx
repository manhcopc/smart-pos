import type { Metadata } from "next";
import type { ReactNode } from "react";
import { QueryProvider } from "@/providers/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart-POS — Quản lý bán hàng & Kho đa chi nhánh",
  description:
    "Nền tảng SaaS POS bán hàng tại quầy và quản lý kho thời gian thực cho nhiều cửa hàng.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen font-sans">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
