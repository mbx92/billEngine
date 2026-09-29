CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"currency" varchar(3) DEFAULT 'IDR' NOT NULL,
	"price_amount" bigint NOT NULL,
	"billing_cycle" "billing_cycle" NOT NULL,
	"inclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_price_amount_check" CHECK ("plans"."price_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "plan_name" varchar(160);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "plan_inclusions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_name_uidx" ON "plans" USING btree ("name");--> statement-breakpoint
CREATE INDEX "plans_active_idx" ON "plans" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_plan_id_idx" ON "services" USING btree ("plan_id");