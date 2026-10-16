ALTER TABLE "infrastructure_nodes" ADD COLUMN "previous_agent_version" varchar(64);--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "target_agent_version" varchar(64);--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "agent_update_status" varchar(24) DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "agent_last_update_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "agent_last_update_error" text;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD CONSTRAINT "infrastructure_nodes_agent_update_status_check" CHECK ("infrastructure_nodes"."agent_update_status" in ('idle', 'queued', 'staging', 'succeeded', 'failed'));