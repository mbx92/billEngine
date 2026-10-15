CREATE TABLE "infrastructure_database_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"engine" varchar(32) DEFAULT 'postgresql' NOT NULL,
	"mode" varchar(24) DEFAULT 'standalone' NOT NULL,
	"status" varchar(24) DEFAULT 'validating' NOT NULL,
	"primary_resource_id" uuid NOT NULL,
	"activation_operation_id" uuid,
	"admin_database" varchar(63) DEFAULT 'postgres' NOT NULL,
	"provisioner_username" varchar(63) NOT NULL,
	"default_connection_limit" integer DEFAULT 20 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"activated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infrastructure_database_clusters_engine_check" CHECK ("infrastructure_database_clusters"."engine" in ('postgresql')),
	CONSTRAINT "infrastructure_database_clusters_mode_check" CHECK ("infrastructure_database_clusters"."mode" in ('standalone', 'replicated')),
	CONSTRAINT "infrastructure_database_clusters_status_check" CHECK ("infrastructure_database_clusters"."status" in ('validating', 'active', 'degraded', 'offline', 'maintenance', 'retired')),
	CONSTRAINT "infrastructure_database_clusters_connection_limit_check" CHECK ("infrastructure_database_clusters"."default_connection_limit" > 0)
);
--> statement-breakpoint
ALTER TABLE "infrastructure_database_clusters" ADD CONSTRAINT "infrastructure_database_clusters_primary_resource_id_infrastructure_resources_id_fk" FOREIGN KEY ("primary_resource_id") REFERENCES "public"."infrastructure_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_database_clusters" ADD CONSTRAINT "infrastructure_database_clusters_activation_operation_id_infrastructure_operations_id_fk" FOREIGN KEY ("activation_operation_id") REFERENCES "public"."infrastructure_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_database_clusters" ADD CONSTRAINT "infrastructure_database_clusters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_database_clusters_name_uidx" ON "infrastructure_database_clusters" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_database_clusters_primary_resource_uidx" ON "infrastructure_database_clusters" USING btree ("primary_resource_id");--> statement-breakpoint
CREATE INDEX "infrastructure_database_clusters_status_idx" ON "infrastructure_database_clusters" USING btree ("status");