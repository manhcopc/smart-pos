-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'BRANCH_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'BRANCH_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_UPDATED';

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_tenant_id_family_id_idx" ON "refresh_sessions"("tenant_id", "family_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_tenant_id_member_id_idx" ON "refresh_sessions"("tenant_id", "member_id");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "tenant_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security for refresh_sessions
ALTER TABLE "refresh_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "refresh_sessions"
  FOR SELECT
  USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation_insert ON "refresh_sessions"
  FOR INSERT
  WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation_update ON "refresh_sessions"
  FOR UPDATE
  USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation_delete ON "refresh_sessions"
  FOR DELETE
  USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "refresh_sessions" TO smartpos_app;
