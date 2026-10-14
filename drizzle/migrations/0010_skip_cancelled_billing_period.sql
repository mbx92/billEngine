ALTER TABLE "service_billing_runs" ALTER COLUMN "invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "service_billing_runs" DROP CONSTRAINT "service_billing_runs_invoice_id_invoices_id_fk";--> statement-breakpoint
ALTER TABLE "service_billing_runs" ADD CONSTRAINT "service_billing_runs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
