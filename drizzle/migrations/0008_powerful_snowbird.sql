CREATE TABLE "database_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coolify_server_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"engine" varchar(32) DEFAULT 'postgresql' NOT NULL,
	"host" varchar(253) NOT NULL,
	"port" integer DEFAULT 5432 NOT NULL,
	"admin_database" varchar(63) DEFAULT 'postgres' NOT NULL,
	"provisioner_username" varchar(63) NOT NULL,
	"credential_encrypted" text NOT NULL,
	"ssl_mode" varchar(32) DEFAULT 'prefer' NOT NULL,
	"default_connection_limit" integer DEFAULT 20 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"database_cluster_id" uuid NOT NULL,
	"provisioning_job_id" uuid,
	"database_name" varchar(63) NOT NULL,
	"role_name" varchar(63) NOT NULL,
	"password_encrypted" text NOT NULL,
	"status" varchar(32) DEFAULT 'provisioning' NOT NULL,
	"last_error" text,
	"sql_imported_at" timestamp with time zone,
	"retention_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deployment_blueprints" ADD COLUMN "database_cluster_id" uuid;--> statement-breakpoint
ALTER TABLE "deployment_blueprints" ADD COLUMN "database_environment_key" varchar(255) DEFAULT 'DATABASE_URL' NOT NULL;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD COLUMN "sql_import_encrypted" text;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD COLUMN "sql_import_filename" varchar(255);--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD COLUMN "sql_import_size" integer;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD COLUMN "sql_import_checksum" varchar(64);--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD COLUMN "service_database_id" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "database_mode" varchar(32) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "plan_database_mode" varchar(32) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "database_clusters" ADD CONSTRAINT "database_clusters_coolify_server_id_coolify_servers_id_fk" FOREIGN KEY ("coolify_server_id") REFERENCES "public"."coolify_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_databases" ADD CONSTRAINT "service_databases_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_databases" ADD CONSTRAINT "service_databases_database_cluster_id_database_clusters_id_fk" FOREIGN KEY ("database_cluster_id") REFERENCES "public"."database_clusters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_databases" ADD CONSTRAINT "service_databases_provisioning_job_id_provisioning_jobs_id_fk" FOREIGN KEY ("provisioning_job_id") REFERENCES "public"."provisioning_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "database_clusters_name_uidx" ON "database_clusters" USING btree ("name");--> statement-breakpoint
CREATE INDEX "database_clusters_server_id_idx" ON "database_clusters" USING btree ("coolify_server_id");--> statement-breakpoint
CREATE INDEX "database_clusters_active_idx" ON "database_clusters" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "service_databases_active_service_uidx" ON "service_databases" USING btree ("service_id") WHERE "service_databases"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_databases_cluster_database_uidx" ON "service_databases" USING btree ("database_cluster_id","database_name");--> statement-breakpoint
CREATE UNIQUE INDEX "service_databases_cluster_role_uidx" ON "service_databases" USING btree ("database_cluster_id","role_name");--> statement-breakpoint
CREATE INDEX "service_databases_cluster_id_idx" ON "service_databases" USING btree ("database_cluster_id");--> statement-breakpoint
CREATE INDEX "service_databases_status_idx" ON "service_databases" USING btree ("status");--> statement-breakpoint
ALTER TABLE "deployment_blueprints" ADD CONSTRAINT "deployment_blueprints_database_cluster_id_database_clusters_id_fk" FOREIGN KEY ("database_cluster_id") REFERENCES "public"."database_clusters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_service_database_id_service_databases_id_fk" FOREIGN KEY ("service_database_id") REFERENCES "public"."service_databases"("id") ON DELETE set null ON UPDATE no action;