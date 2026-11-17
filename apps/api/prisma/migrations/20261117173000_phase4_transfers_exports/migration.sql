-- Phase 4: Inter-branch stock transfers, background Excel exports & extended audit actions

ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER_DISPATCHED';
ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER_RECEIVED';
ALTER TYPE "AuditAction" ADD VALUE 'CUSTOMER_LOYALTY_ADJUST';

CREATE TYPE "StockTransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "ReportExportType" AS ENUM ('SALES_DETAIL', 'INVENTORY_LEDGER', 'DAILY_SUMMARY');

-- CreateTable: stock_transfers
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "created_by_member_id" UUID NOT NULL,
    "received_by_member_id" UUID,
    "note" TEXT,
    "dispatched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfers_tenant_id_code_key" ON "stock_transfers"("tenant_id", "code");
CREATE INDEX "stock_transfers_tenant_id_from_branch_id_created_at_idx" ON "stock_transfers"("tenant_id", "from_branch_id", "created_at" DESC);
CREATE INDEX "stock_transfers_tenant_id_to_branch_id_status_idx" ON "stock_transfers"("tenant_id", "to_branch_id", "status");

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "tenant_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_member_id_fkey" FOREIGN KEY ("received_by_member_id") REFERENCES "tenant_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_distinct_branches" CHECK ("from_branch_id" <> "to_branch_id");

-- CreateTable: stock_transfer_items
CREATE TABLE "stock_transfer_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,
    "unit_cost" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_transfer_items_tenant_id_transfer_id_idx" ON "stock_transfer_items"("tenant_id", "transfer_id");
CREATE INDEX "stock_transfer_items_tenant_id_variant_id_idx" ON "stock_transfer_items"("tenant_id", "variant_id");

ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_qty_positive" CHECK ("quantity" > 0);

-- CreateTable: report_export_jobs
CREATE TABLE "report_export_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by_member_id" UUID NOT NULL,
    "report_type" "ReportExportType" NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "report_export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_export_jobs_tenant_id_created_at_idx" ON "report_export_jobs"("tenant_id", "created_at" DESC);
CREATE INDEX "report_export_jobs_tenant_id_status_idx" ON "report_export_jobs"("tenant_id", "status");

ALTER TABLE "report_export_jobs" ADD CONSTRAINT "report_export_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_export_jobs" ADD CONSTRAINT "report_export_jobs_requested_by_member_id_fkey" FOREIGN KEY ("requested_by_member_id") REFERENCES "tenant_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security for new Phase 4 tenant-scoped tables
DO $$
DECLARE
  tbl TEXT;
  phase4_tables TEXT[] := ARRAY[
    'stock_transfers',
    'stock_transfer_items',
    'report_export_jobs'
  ];
BEGIN
  FOREACH tbl IN ARRAY phase4_tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (tenant_id = (SELECT NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid));',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK (tenant_id = (SELECT NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid));',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON %I FOR UPDATE USING (tenant_id = (SELECT NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)) WITH CHECK (tenant_id = (SELECT NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid));',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON %I FOR DELETE USING (tenant_id = (SELECT NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid));',
      tbl
    );

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO smartpos_app;', tbl);
  END LOOP;
END
$$;
