CREATE TABLE "infrastructure_database_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_database_id" uuid NOT NULL,
	"create_operation_id" uuid NOT NULL,
	"restore_operation_id" uuid,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"storage_path" text,
	"checksum_sha256" varchar(64),
	"size_bytes" bigint,
	"last_error" text,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"restored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infrastructure_database_backups_status_check" CHECK ("infrastructure_database_backups"."status" in ('queued', 'creating', 'available', 'restoring', 'failed')),
	CONSTRAINT "infrastructure_database_backups_checksum_check" CHECK ("infrastructure_database_backups"."checksum_sha256" is null or "infrastructure_database_backups"."checksum_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "infrastructure_database_backups_size_check" CHECK ("infrastructure_database_backups"."size_bytes" is null or "infrastructure_database_backups"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "cpu_usage_basis_points" integer;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "memory_used_bytes" bigint;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "disk_used_bytes" bigint;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "disk_usage_basis_points" integer;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "utilization_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD CONSTRAINT "infrastructure_database_backups_service_database_id_infrastructure_service_databases_id_fk" FOREIGN KEY ("service_database_id") REFERENCES "public"."infrastructure_service_databases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD CONSTRAINT "infrastructure_database_backups_create_operation_id_infrastructure_operations_id_fk" FOREIGN KEY ("create_operation_id") REFERENCES "public"."infrastructure_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD CONSTRAINT "infrastructure_database_backups_restore_operation_id_infrastructure_operations_id_fk" FOREIGN KEY ("restore_operation_id") REFERENCES "public"."infrastructure_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD CONSTRAINT "infrastructure_database_backups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_database_backups_create_operation_uidx" ON "infrastructure_database_backups" USING btree ("create_operation_id");--> statement-breakpoint
CREATE INDEX "infrastructure_database_backups_service_created_idx" ON "infrastructure_database_backups" USING btree ("service_database_id","created_at");--> statement-breakpoint
CREATE INDEX "infrastructure_database_backups_status_idx" ON "infrastructure_database_backups" USING btree ("status");--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD CONSTRAINT "infrastructure_nodes_utilization_check" CHECK (("infrastructure_nodes"."cpu_usage_basis_points" is null or "infrastructure_nodes"."cpu_usage_basis_points" between 0 and 10000)
        and ("infrastructure_nodes"."memory_used_bytes" is null or "infrastructure_nodes"."memory_used_bytes" >= 0)
        and ("infrastructure_nodes"."disk_used_bytes" is null or "infrastructure_nodes"."disk_used_bytes" >= 0)
        and ("infrastructure_nodes"."disk_usage_basis_points" is null or "infrastructure_nodes"."disk_usage_basis_points" between 0 and 10000));