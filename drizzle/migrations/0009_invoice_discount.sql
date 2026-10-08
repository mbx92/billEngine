ALTER TABLE "invoices" ADD COLUMN "discount_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "discount_percent" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discount_amount_check" CHECK ("invoices"."discount_amount" >= 0);
