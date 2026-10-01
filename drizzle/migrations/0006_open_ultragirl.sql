CREATE TABLE "resource_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"cname_target" varchar(253),
	"provider_hostname_id" varchar(160),
	"provider_hostname_status" varchar(64),
	"provider_ssl_status" varchar(64),
	"verification_records" jsonb,
	"compose_service_name" varchar(160),
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_domains" ADD CONSTRAINT "resource_domains_resource_id_coolify_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."coolify_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_domains_hostname_uidx" ON "resource_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "resource_domains_resource_id_idx" ON "resource_domains" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "resource_domains_status_idx" ON "resource_domains" USING btree ("status");