ALTER TABLE "infrastructure_nodes" ADD COLUMN "gateway_status" varchar(24) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "gateway_version" varchar(160);--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "gateway_container_id" varchar(128);--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "gateway_last_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "gateway_last_error" text;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD CONSTRAINT "infrastructure_nodes_gateway_status_check" CHECK ("infrastructure_nodes"."gateway_status" in ('pending', 'installing', 'healthy', 'failed', 'unknown'));