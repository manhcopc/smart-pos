"use client";

import { ROLES, type Role } from "@smart-pos/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  DatabaseIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ServerIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type DataMode,
  getDataMode,
  getMockRole,
  setDataMode,
  setMockRole,
  subscribeDataModeChange,
} from "@/lib/data-mode";
import { ROLE_LABELS } from "@/lib/labels";
import { resetMockState } from "@/lib/mock-data/mock-router";

const ENABLED_IN_PROD = process.env.NEXT_PUBLIC_SHOW_DATA_SWITCHER === "true";

export function DataModeSwitcher() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mode, setModeState] = useState<DataMode>("real");
  const [role, setRoleState] = useState<Role>("OWNER");

  useEffect(() => {
    setMounted(true);
    const sync = () => {
      setModeState(getDataMode());
      setRoleState(getMockRole());
    };
    sync();
    return subscribeDataModeChange(sync);
  }, []);

  if (!mounted || process.env.NODE_ENV === "test") {
    return null;
  }
  if (process.env.NODE_ENV === "production" && !ENABLED_IN_PROD) {
    return null;
  }

  async function handleToggleMode(nextMode: DataMode) {
    setDataMode(nextMode);
    setModeState(nextMode);
    await queryClient.resetQueries();

    if (nextMode === "mock") {
      toast.success("Đã chuyển sang Mock Data (không cần Backend)");
      const target = getMockRole() === "CASHIER" ? "/pos" : "/dashboard";
      if (pathname === "/login" || pathname === "/register") {
        router.push(target);
      }
    } else {
      toast.info("Đã chuyển sang Real API (http://localhost:4000)");
    }
  }

  async function handleSwitchRole(nextRole: Role) {
    if (mode !== "mock") {
      setDataMode("mock");
      setModeState("mock");
    }
    setMockRole(nextRole);
    setRoleState(nextRole);
    await queryClient.resetQueries();
    const target = nextRole === "CASHIER" ? "/pos" : "/dashboard";
    toast.success(`Đang xem giao diện với vai trò: ${ROLE_LABELS[nextRole]}`);
    router.push(target);
  }

  async function handleResetMock() {
    resetMockState();
    await queryClient.resetQueries();
    toast.success("Đã khôi phục dữ liệu Mock ban đầu");
  }

  return (
    <div className="pos-no-print fixed left-3 bottom-3 z-50 flex flex-col items-start gap-2">
      {expanded ? (
        <div className="w-80 rounded-xl border bg-card p-3.5 text-card-foreground shadow-lg">
          <div className="flex items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontalIcon className="size-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide">
                Chế độ dữ liệu kiểm thử
              </span>
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Đóng bảng chuyển chế độ"
              onClick={() => setExpanded(false)}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted p-1">
            <Button
              type="button"
              size="sm"
              variant={mode === "mock" ? "default" : "ghost"}
              onClick={() => void handleToggleMode("mock")}
            >
              <DatabaseIcon data-icon="inline-start" />
              Mock Data
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "real" ? "default" : "ghost"}
              onClick={() => void handleToggleMode("real")}
            >
              <ServerIcon data-icon="inline-start" />
              Real API
            </Button>
          </div>

          {mode === "mock" ? (
            <div className="mt-3 flex flex-col gap-2.5 border-t pt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">
                  Đổi nhanh Role (xem màn hình):
                </span>
                <Badge variant="secondary">{role}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {ROLES.map((r) => (
                  <Button
                    key={r}
                    type="button"
                    size="sm"
                    variant={role === r ? "default" : "outline"}
                    className="justify-start text-xs"
                    onClick={() => void handleSwitchRole(r)}
                  >
                    {ROLE_LABELS[r]}
                  </Button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-muted-foreground">
                  PIN Quản lý demo: <code className="font-mono font-semibold">1234</code>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleResetMock()}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Reset Mock
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2.5 text-xs text-muted-foreground">
              Đang gọi Backend API thật tại{" "}
              <code className="font-mono">NEXT_PUBLIC_API_URL</code>. Bấm{" "}
              <strong>Mock Data</strong> để thử giao diện độc lập không cần DB.
            </p>
          )}
        </div>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant={mode === "mock" ? "default" : "outline"}
        className="gap-1.5 shadow-md"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {mode === "mock" ? (
          <DatabaseIcon className="size-3.5" />
        ) : (
          <RefreshCwIcon className="size-3.5" />
        )}
        <span>{mode === "mock" ? `MOCK · ${role}` : "REAL API"}</span>
      </Button>
    </div>
  );
}
