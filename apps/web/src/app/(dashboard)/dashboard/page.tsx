import {
  BoxesIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  ReceiptIcon,
  ScanBarcodeIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const NAV_ITEMS = [
  { label: "Tổng quan", icon: LayoutDashboardIcon },
  { label: "Hàng hóa & Mã vạch", icon: BoxesIcon },
  { label: "Nhập kho & Kiểm kho", icon: ClipboardListIcon },
  { label: "Hóa đơn & Trả hàng", icon: ReceiptIcon },
  { label: "Nhân viên & Phân quyền", icon: UsersIcon },
] as const;

const SUMMARY_CARDS = [
  {
    title: "Doanh thu thuần hôm nay",
    value: "0 ₫",
    hint: "Tổng hợp từ daily_branch_summaries",
  },
  {
    title: "Lợi nhuận gộp ước tính",
    value: "0 ₫",
    hint: "Tính theo giá vốn bình quân gia quyền (AVCO)",
  },
  {
    title: "Cảnh báo dưới tồn tối thiểu",
    value: "0 SKU",
    hint: "on_hand <= min_stock_alert",
  },
] as const;

export default function DashboardPage() {
  return (
    <div className="grid min-h-screen md:grid-cols-[240px_1fr]">
      <aside className="flex flex-col gap-4 border-r bg-muted/30 p-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold">
            Smart-POS Admin
          </Link>
          <Badge variant="secondary">Phase 0</Badge>
        </div>
        <Separator />
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.label}
                variant="ghost"
                className="justify-start"
                type="button"
              >
                <Icon data-icon="inline-start" />
                {item.label}
              </Button>
            );
          })}
        </nav>
        <div className="mt-auto">
          <Button
            className="w-full"
            render={<Link href="/pos" />}
            nativeButton={false}
          >
            <ScanBarcodeIcon data-icon="inline-start" />
            Mở quầy POS
          </Button>
        </div>
      </aside>

      <main className="flex flex-col gap-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Khu Quản trị Cửa hàng</h1>
            <p className="text-sm text-muted-foreground">
              Khung Management Area sẵn sàng kết nối API Phase 1–2.
            </p>
          </div>
          <Badge variant="outline">Chi nhánh mặc định</Badge>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {SUMMARY_CARDS.map((card) => (
            <Card key={card.title}>
              <CardHeader>
                <CardDescription>{card.title}</CardDescription>
                <CardTitle className="font-mono text-2xl">{card.value}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {card.hint}
              </CardContent>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}
