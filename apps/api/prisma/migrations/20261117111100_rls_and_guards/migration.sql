-- =============================================================================
-- Smart-POS Row-Level Security (RLS) & Database Integrity Guards
-- =============================================================================

-- 1. Helper expression wrapped in a subselect in policies so PostgreSQL
--    evaluates current_setting once per statement (InitPlan) rather than per row.
--    NULLIF(..., '') ensures an unset or empty GUC fails closed (NULL != tenant_id).

DO $$
DECLARE
  tbl TEXT;
  tenant_tables TEXT[] := ARRAY[
    'branches',
    'tenant_members',
    'audit_logs',
    'categories',
    'products',
    'product_variants',
    'branch_inventories',
    'inventory_ledgers',
    'suppliers',
    'purchase_orders',
    'purchase_order_items',
    'stock_counts',
    'stock_count_items',
    'register_shifts',
    'customers',
    'invoices',
    'invoice_items',
    'invoice_payments',
    'sales_returns',
    'sales_return_items',
    'daily_branch_summaries'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables
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
  END LOOP;
END
$$;

-- 2. Database-level financial & inventory invariant constraints
ALTER TABLE "branch_inventories"
  ADD CONSTRAINT "branch_inventories_on_hand_non_negative" CHECK ("on_hand" >= 0),
  ADD CONSTRAINT "branch_inventories_reserved_non_negative" CHECK ("reserved" >= 0),
  ADD CONSTRAINT "branch_inventories_avg_cost_non_negative" CHECK ("avg_cost" >= 0);

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_loyalty_points_non_negative" CHECK ("loyalty_points" >= 0);

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_qty_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "invoice_items_returned_qty_within_sold" CHECK ("returned_qty" >= 0 AND "returned_qty" <= "quantity");

-- 3. Non-superuser, non-BYPASSRLS least-privilege role for runtime RLS enforcement
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartpos_app') THEN
    CREATE ROLE smartpos_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO smartpos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO smartpos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smartpos_app;
