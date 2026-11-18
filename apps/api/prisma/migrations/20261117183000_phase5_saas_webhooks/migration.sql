-- Phase 5: SaaS Subscription Billing, Omnichannel API Keys, Webhooks & Accounting Exports

ALTER TYPE "AuditAction" ADD VALUE 'PLAN_UPGRADED';
ALTER TYPE "AuditAction" ADD VALUE 'API_KEY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'API_KEY_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'WEBHOOK_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'WEBHOOK_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'EXTERNAL_ORDER_SYNCED';

ALTER TYPE "ReportExportType" ADD VALUE 'ACCOUNTING_LEDGER';

CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateTable: subscription_billings
CREATE TABLE "subscription_billings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_code" "SubscriptionPlanCode" NOT NULL,
    "billing_months" INTEGER NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" "BillingStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'INTERNAL_QR',
    "reference_no" TEXT,
    "period_start" TIMESTAMPTZ NOT NULL,
    "period_end" TIMESTAMPTZ NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_billings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscription_billings_tenant_id_created_at_idx" ON "subscription_billings"("tenant_id", "created_at" DESC);
ALTER TABLE "subscription_billings" ADD CONSTRAINT "subscription_billings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: tenant_api_keys
CREATE TABLE "tenant_api_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by_member_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_api_keys_key_hash_key" ON "tenant_api_keys"("key_hash");
CREATE INDEX "tenant_api_keys_tenant_id_is_active_idx" ON "tenant_api_keys"("tenant_id", "is_active");
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "tenant_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: webhook_endpoints
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "signing_secret" TEXT NOT NULL,
    "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_endpoints_tenant_id_is_active_idx" ON "webhook_endpoints"("tenant_id", "is_active");
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: webhook_deliveries
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "http_status" INTEGER,
    "response_snippet" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_deliveries_tenant_id_created_at_idx" ON "webhook_deliveries"("tenant_id", "created_at" DESC);
CREATE INDEX "webhook_deliveries_tenant_id_endpoint_id_idx" ON "webhook_deliveries"("tenant_id", "endpoint_id");
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security for Phase 5 tenant-scoped tables
DO $$
DECLARE
  tbl TEXT;
  phase5_tables TEXT[] := ARRAY[
    'subscription_billings',
    'tenant_api_keys',
    'webhook_endpoints',
    'webhook_deliveries'
  ];
BEGIN
  FOREACH tbl IN ARRAY phase5_tables
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
