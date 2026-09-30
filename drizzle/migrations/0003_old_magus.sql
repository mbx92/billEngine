CREATE TYPE "public"."credit_note_status" AS ENUM('issued', 'voided');--> statement-breakpoint
CREATE TYPE "public"."email_delivery_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"credit_note_number" varchar(48) NOT NULL,
	"status" "credit_note_status" DEFAULT 'issued' NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_amount_check" CHECK ("credit_notes"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" varchar(48) NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"status" "email_delivery_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"provider_message_id" varchar(255),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credited_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_number_uidx" ON "credit_notes" USING btree ("credit_note_number");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_id_idx" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "credit_notes_status_idx" ON "credit_notes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_idempotency_uidx" ON "email_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_deliveries_invoice_id_idx" ON "email_deliveries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "email_deliveries_status_idx" ON "email_deliveries" USING btree ("status");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credited_amount_check" CHECK ("invoices"."credited_amount" >= 0);