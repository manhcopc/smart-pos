-- Allow omnichannel / e-commerce synced invoices when no cashier register shift is attached
ALTER TABLE "invoices" ALTER COLUMN "shift_id" DROP NOT NULL;
