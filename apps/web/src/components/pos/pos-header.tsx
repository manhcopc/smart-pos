"use client";

import type { RegisterShiftItem } from "@smart-pos/shared";
import {
  CloudOffIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  ReceiptIcon,
  RefreshCwIcon,
  SearchIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import Link from "next/link";
import type { FormEvent, RefObject } from "react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatVndAmount, ROLE_LABELS } from "@/lib/labels";
import type { QueuedOfflineInvoice } from "@/lib/pos-offline-queue";

interface PosBranchOption {
  id: string;
  code: string;
  name: string;
}

interface PosHeaderProps {
  tenantName: string;
  userFullName: string;
  employeeCode: string;
  role: keyof typeof ROLE_LABELS;
  branches: readonly PosBranchOption[];
  activeBranch: PosBranchOption | undefined;
  onBranchChange: (branchId: string) => void;
  isEffectivelyOnline: boolean;
  sseConnected: boolean;
  manualOfflineMode: boolean;
  onToggleManualOffline: () => void;
  offlineQueue: readonly QueuedOfflineInvoice[];
  onOpenOfflineQueue: () => void;
  currentShift: RegisterShiftItem | null;
  onOpenZReport: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRefetchCatalog: () => void;
  onOpenCashDrawer: () => void;
  onToggleRecentInvoices: () => void;
  canOpenDashboard: boolean;
  onLogout: () => void;
  logoutPending: boolean;
}

export function PosHeader({
  tenantName,
  userFullName,
  employeeCode,
  role,
  branches,
  activeBranch,
  onBranchChange,
  isEffectivelyOnline,
  sseConnected,
  manualOfflineMode,
  onToggleManualOffline,
  offlineQueue,
  onOpenOfflineQueue,
  currentShift,
  onOpenZReport,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchSubmit,
  onRefetchCatalog,
  onOpenCashDrawer,
  onToggleRecentInvoices,
  canOpenDashboard,
  onLogout,
  logoutPending,
}: PosHeaderProps) {
  return (
    <header className="pos-no-print flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{tenantName}</span>
        <Badge variant="secondary">
          {userFullName} ({employeeCode}) · {ROLE_LABELS[role]}
        </Badge>

        {branches.length > 0 ? (
          <Select
            value={activeBranch?.id ?? ""}
            onValueChange={(value) => {
              if (value) onBranchChange(value);
            }}
          >
            <SelectTrigger size="sm" className="w-48">
              <SelectValue>
                {activeBranch
                  ? `${activeBranch.code} · ${activeBranch.name}`
                  : "Chọn chi nhánh"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.code} · {branch.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}

        <Badge
          variant={
            !isEffectivelyOnline
              ? "destructive"
              : sseConnected
                ? "secondary"
                : "outline"
          }
          className="gap-1"
        >
          {!isEffectivelyOnline ? (
            <CloudOffIcon className="size-3" />
          ) : sseConnected ? (
            <WifiIcon className="size-3" />
          ) : (
            <WifiOffIcon className="size-3" />
          )}
          {!isEffectivelyOnline
            ? "Đang Offline"
            : sseConnected
              ? "Realtime Kho"
              : "Cache Cục bộ"}
        </Badge>

        <Button
          type="button"
          size="sm"
          variant={manualOfflineMode ? "destructive" : "ghost"}
          aria-label="Chuyển chế độ Offline"
          onClick={onToggleManualOffline}
        >
          {manualOfflineMode ? "Bật Online" : "Giả lập Offline"}
        </Button>

        {offlineQueue.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant={
              offlineQueue.some((e) => e.status !== "PENDING")
                ? "destructive"
                : "outline"
            }
            onClick={onOpenOfflineQueue}
          >
            <CloudOffIcon data-icon="inline-start" />
            Hàng đợi Offline ({offlineQueue.length})
          </Button>
        ) : null}

        {currentShift ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenZReport}
          >
            Ca mở · Két: {formatVndAmount(currentShift.expectedCash)}
          </Button>
        ) : (
          <Badge variant="outline">Chưa mở ca</Badge>
        )}
      </div>

      <form
        onSubmit={onSearchSubmit}
        className="flex flex-1 items-center gap-2 md:max-w-md"
      >
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          aria-label="Tìm hàng hóa hoặc quét mã vạch"
          placeholder="Quét mã vạch hoặc gõ SKU/tên (F2)..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Đồng bộ lại danh mục"
          onClick={onRefetchCatalog}
        >
          <RefreshCwIcon />
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {currentShift ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenCashDrawer}
            >
              <KeyRoundIcon data-icon="inline-start" />
              Mở két
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onToggleRecentInvoices}
            >
              <ReceiptIcon data-icon="inline-start" />
              Hóa đơn ca
            </Button>
          </>
        ) : null}

        {canOpenDashboard ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/dashboard" />}
            nativeButton={false}
          >
            <LayoutDashboardIcon data-icon="inline-start" />
            Quản trị
          </Button>
        ) : null}

        <ThemeToggle />

        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          disabled={logoutPending}
        >
          <LogOutIcon data-icon="inline-start" />
          Đổi ca
        </Button>
      </div>
    </header>
  );
}
