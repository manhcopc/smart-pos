import {
  CreditCardIcon,
  LayoutDashboardIcon,
  PrinterIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PosTerminalPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Smart-POS Terminal</span>
          <Badge variant="secondary">Ca chưa mở (Phase 3)</Badge>
        </div>
        <div className="flex flex-1 items-center gap-2 md:max-w-md">
          <SearchIcon className="size-4 text-muted-foreground" />
          <Input
            aria-label="Tìm hàng hóa hoặc quét mã vạch"
            placeholder="Tìm tên hàng, SKU hoặc quét mã vạch (F2)..."
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/dashboard" />}
          nativeButton={false}
        >
          <LayoutDashboardIcon data-icon="inline-start" />
          Quản trị
        </Button>
      </header>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[1fr_380px]">
        <section className="flex flex-col gap-4">
          <Tabs defaultValue="inv-1">
            <TabsList>
              <TabsTrigger value="inv-1">Hóa đơn 1</TabsTrigger>
              <TabsTrigger value="inv-2">Hóa đơn 2</TabsTrigger>
            </TabsList>
            <TabsContent value="inv-1" className="pt-2">
              <Card>
                <CardHeader>
                  <CardTitle>Giỏ hàng hiện tại</CardTitle>
                  <CardDescription>
                    Danh mục đồng bộ IndexedDB sẽ hiển thị tại đây để tìm kiếm
                    &lt; 50ms ở Phase 3.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Chưa có sản phẩm nào trong hóa đơn. Quét mã vạch hoặc bấm nút
                  Quick-keys để thêm hàng.
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="inv-2" className="pt-2">
              <Card>
                <CardHeader>
                  <CardTitle>Hóa đơn chờ 2</CardTitle>
                  <CardDescription>
                    Giữ song song nhiều hóa đơn khi khách chọn thêm đồ.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Tab hóa đơn chờ đang trống.
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        <aside>
          <Card>
            <CardHeader>
              <CardTitle>Thanh toán (Split Payment)</CardTitle>
              <CardDescription>
                Tiền mặt · VietQR · Thẻ · Điểm tích lũy
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tạm tính</span>
                <span className="font-mono font-medium">0.00 ₫</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Giảm giá</span>
                <span className="font-mono">0.00 ₫</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="font-medium">Khách cần trả</span>
                <span className="font-mono text-lg font-semibold">0.00 ₫</span>
              </div>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button variant="outline" className="flex-1" type="button">
                <PrinterIcon data-icon="inline-start" />
                In tạm tính
              </Button>
              <Button className="flex-1" type="button">
                <CreditCardIcon data-icon="inline-start" />
                Thanh toán (F9)
              </Button>
            </CardFooter>
          </Card>
        </aside>
      </div>
    </div>
  );
}
