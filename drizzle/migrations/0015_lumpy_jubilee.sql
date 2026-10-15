CREATE TABLE "infrastructure_service_databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"database_cluster_id" uuid NOT NULL,
	"application_resource_id" uuid NOT NULL,
	"provisioning_operation_id" uuid,
	"redeploy_operation_id" uuid,
	"database_name" varchar(63) NOT NULL,
	"role_name" varchar(63) NOT NULL,
	"password_encrypted" text NOT NULL,
	"connection_uri_encrypted" text NOT NULL,
	"environment_key" varchar(255) DEFAULT 'DATABASE_URL' NOT NULL,
	"status" varchar(32) DEFAULT 'provisioning' NOT NULL,
	"last_error" text,
	"provisioned_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "infrastructure_service_databases_status_check" CHECK ("infrastructure_service_databases"."status" in ('provisioning', 'active', 'failed', 'pending_deletion', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "infrastructure_service_databases" ADD CONSTRAINT "infrastructure_service_databases_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_service_databases" ADD CONSTRAINT "infrastructure_service_databases_database_cluster_id_infrastructure_database_clusters_id_fk" FOREIGN KEY ("database_cluster_id") REFERENCES "public"."infrastructure_database_clusters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_service_databases" ADD CONSTRAINT "infrastructure_service_databases_application_resource_id_infrastructure_resources_id_fk" FOREIGN KEY ("application_resource_id") REFERENCES "public"."infrastructure_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_service_databases" ADD CONSTRAINT "infrastructure_service_databases_provisioning_operation_id_infrastructure_operations_id_fk" FOREIGN KEY ("provisioning_operation_id") REFERENCES "public"."infrastructure_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_service_databases" ADD CONSTRAINT "infrastructure_service_databases_redeploy_operation_id_infrastructure_operations_id_fk" FOREIGN KEY ("redeploy_operation_id") REFERENCES "public"."infrastructure_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_service_databases" ADD CONSTRAINT "infrastructure_service_databases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_service_databases_active_service_uidx" ON "infrastructure_service_databases" USING btree ("service_id") WHERE "infrastructure_service_databases"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_service_databases_active_application_uidx" ON "infrastructure_service_databases" USING btree ("application_resource_id") WHERE "infrastructure_service_databases"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_service_databases_cluster_database_uidx" ON "infrastructure_service_databases" USING btree ("database_cluster_id","database_name");--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_service_databases_cluster_role_uidx" ON "infrastructure_service_databases" USING btree ("database_cluster_id","role_name");--> statement-breakpoint
CREATE INDEX "infrastructure_service_databases_cluster_id_idx" ON "infrastructure_service_databases" USING btree ("database_cluster_id");--> statement-breakpoint
CREATE INDEX "infrastructure_service_databases_status_idx" ON "infrastructure_service_databases" USING btree ("status");