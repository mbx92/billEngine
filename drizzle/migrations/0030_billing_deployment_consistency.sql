ALTER TABLE "payments" ADD COLUMN "idempotency_key" varchar(200);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "request_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "infrastructure_status" varchar(24) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "infrastructure_error" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "billing_mode" varchar(16) DEFAULT 'postpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "billing_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key_uidx" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
-- Preserve existing billing schedules. Only services created after this migration
-- wait for their first successful deployment before starting postpaid billing.
UPDATE "services" SET "activated_at" = "created_at";
