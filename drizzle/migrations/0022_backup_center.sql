CREATE TABLE "infrastructure_backup_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"provider" varchar(24) DEFAULT 's3' NOT NULL,
	"endpoint" text NOT NULL,
	"region" varchar(100) DEFAULT 'auto' NOT NULL,
	"bucket" varchar(255) NOT NULL,
	"prefix" varchar(500) DEFAULT 'oc-backups' NOT NULL,
	"path_style" boolean DEFAULT false NOT NULL,
	"access_key_encrypted" text NOT NULL,
	"secret_key_encrypted" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infrastructure_backup_targets_provider_check" CHECK ("infrastructure_backup_targets"."provider" in ('s3'))
);
--> statement-breakpoint
CREATE TABLE "infrastructure_backup_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"service_database_id" uuid NOT NULL,
	"storage_target_id" uuid NOT NULL,
	"interval_minutes" integer DEFAULT 1440 NOT NULL,
	"retention_count" integer DEFAULT 14 NOT NULL,
	"alert_email" varchar(320),
	"is_active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infrastructure_backup_policies_interval_check" CHECK ("infrastructure_backup_policies"."interval_minutes" between 5 and 525600),
	CONSTRAINT "infrastructure_backup_policies_retention_check" CHECK ("infrastructure_backup_policies"."retention_count" between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" DROP CONSTRAINT "infrastructure_database_backups_status_check";--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD COLUMN "storage_target_id" uuid;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD COLUMN "object_key" text;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD COLUMN "alert_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "infrastructure_backup_targets" ADD CONSTRAINT "infrastructure_backup_targets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_backup_policies" ADD CONSTRAINT "infrastructure_backup_policies_service_database_id_infrastructure_service_databases_id_fk" FOREIGN KEY ("service_database_id") REFERENCES "public"."infrastructure_service_databases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_backup_policies" ADD CONSTRAINT "infrastructure_backup_policies_storage_target_id_infrastructure_backup_targets_id_fk" FOREIGN KEY ("storage_target_id") REFERENCES "public"."infrastructure_backup_targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_backup_policies" ADD CONSTRAINT "infrastructure_backup_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_backup_targets_name_uidx" ON "infrastructure_backup_targets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "infrastructure_backup_targets_active_idx" ON "infrastructure_backup_targets" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_backup_policies_name_uidx" ON "infrastructure_backup_policies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "infrastructure_backup_policies_due_idx" ON "infrastructure_backup_policies" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "infrastructure_backup_policies_database_idx" ON "infrastructure_backup_policies" USING btree ("service_database_id");--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD CONSTRAINT "infrastructure_database_backups_policy_id_infrastructure_backup_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."infrastructure_backup_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD CONSTRAINT "infrastructure_database_backups_storage_target_id_infrastructure_backup_targets_id_fk" FOREIGN KEY ("storage_target_id") REFERENCES "public"."infrastructure_backup_targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_database_backups" ADD CONSTRAINT "infrastructure_database_backups_status_check" CHECK ("infrastructure_database_backups"."status" in ('queued', 'creating', 'available', 'restoring', 'failed', 'deleting', 'deleted'));