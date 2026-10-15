ALTER TABLE "service_resources" DROP CONSTRAINT "service_resources_resource_id_coolify_resources_id_fk";--> statement-breakpoint
DELETE FROM "service_resources" WHERE "infrastructure_resource_id" IS NULL;--> statement-breakpoint
ALTER TABLE "coolify_nodes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coolify_resources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coolify_servers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "resource_domains" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "database_clusters" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deployment_blueprints" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provisioning_job_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_databases" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "coolify_nodes" CASCADE;--> statement-breakpoint
DROP TABLE "coolify_resources" CASCADE;--> statement-breakpoint
DROP TABLE "coolify_servers" CASCADE;--> statement-breakpoint
DROP TABLE "resource_domains" CASCADE;--> statement-breakpoint
DROP TABLE "database_clusters" CASCADE;--> statement-breakpoint
DROP TABLE "deployment_blueprints" CASCADE;--> statement-breakpoint
DROP TABLE "provisioning_job_events" CASCADE;--> statement-breakpoint
DROP TABLE "provisioning_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "service_databases" CASCADE;--> statement-breakpoint
DROP INDEX "service_resources_infrastructure_resource_id_idx";--> statement-breakpoint
DROP INDEX "service_resources_service_resource_uidx";--> statement-breakpoint
DROP INDEX "service_resources_resource_id_idx";--> statement-breakpoint
ALTER TABLE "service_resources" ALTER COLUMN "infrastructure_resource_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "service_resources_service_resource_uidx" ON "service_resources" USING btree ("service_id","infrastructure_resource_id");--> statement-breakpoint
CREATE INDEX "service_resources_resource_id_idx" ON "service_resources" USING btree ("infrastructure_resource_id");--> statement-breakpoint
ALTER TABLE "service_resources" DROP COLUMN "resource_id";
