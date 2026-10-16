CREATE TABLE "application_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"release_id" uuid,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"version" varchar(128) NOT NULL,
	"commit_sha" varchar(64),
	"image_digest" varchar(71),
	"image_reference" text,
	"log_excerpt" text,
	"error_code" varchar(64),
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_builds_status_check" CHECK ("application_builds"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "application_builds_commit_check" CHECK ("application_builds"."commit_sha" is null or "application_builds"."commit_sha" ~ '^[a-f0-9]{7,64}$'),
	CONSTRAINT "application_builds_digest_check" CHECK ("application_builds"."image_digest" is null or "application_builds"."image_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "role" varchar(24) DEFAULT 'deployment' NOT NULL;--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD COLUMN "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "node_enrollments" ADD COLUMN "role" varchar(24) DEFAULT 'deployment' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_builds" ADD CONSTRAINT "application_builds_application_id_deployable_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."deployable_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_builds" ADD CONSTRAINT "application_builds_node_id_infrastructure_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."infrastructure_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_builds" ADD CONSTRAINT "application_builds_operation_id_infrastructure_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."infrastructure_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_builds" ADD CONSTRAINT "application_builds_release_id_application_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."application_releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_builds" ADD CONSTRAINT "application_builds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_builds_operation_uidx" ON "application_builds" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "application_builds_application_created_idx" ON "application_builds" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "application_builds_node_status_idx" ON "application_builds" USING btree ("node_id","status");--> statement-breakpoint
ALTER TABLE "infrastructure_nodes" ADD CONSTRAINT "infrastructure_nodes_role_check" CHECK ("infrastructure_nodes"."role" in ('deployment', 'builder', 'hybrid'));