import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DataModeSwitcher } from "@/components/dev/data-mode-switcher";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/providers/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Smart-POS — Quản lý bán hàng & Kho đa chi nhánh",
    template: "%s | Smart-POS",
  },
  description:
    "Nền tảng SaaS POS bán hàng tại quầy và quản lý kho thời gian thực cho nhiều cửa hàng.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <ThemeProvider>
          <QueryProvider>
            {children}
            <DataModeSwitcher />
          </QueryProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
