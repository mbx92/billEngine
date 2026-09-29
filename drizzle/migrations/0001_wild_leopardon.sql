CREATE TABLE "coolify_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coolify_server_id" uuid NOT NULL,
	"coolify_uuid" varchar(160) NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text,
	"ssh_port" integer,
	"status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"is_reachable" boolean DEFAULT false NOT NULL,
	"is_usable" boolean DEFAULT false NOT NULL,
	"is_coolify_host" boolean DEFAULT false NOT NULL,
	"raw_metadata" jsonb,
	"last_seen_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coolify_resources" ADD COLUMN "coolify_node_uuid" varchar(160);--> statement-breakpoint
ALTER TABLE "coolify_nodes" ADD CONSTRAINT "coolify_nodes_coolify_server_id_coolify_servers_id_fk" FOREIGN KEY ("coolify_server_id") REFERENCES "public"."coolify_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coolify_nodes_server_uuid_uidx" ON "coolify_nodes" USING btree ("coolify_server_id","coolify_uuid");--> statement-breakpoint
CREATE INDEX "coolify_nodes_server_id_idx" ON "coolify_nodes" USING btree ("coolify_server_id");--> statement-breakpoint
CREATE INDEX "coolify_nodes_status_idx" ON "coolify_nodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "coolify_resources_node_uuid_idx" ON "coolify_resources" USING btree ("coolify_node_uuid");