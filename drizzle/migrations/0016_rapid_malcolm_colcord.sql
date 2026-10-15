CREATE TABLE "application_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"version" varchar(160) NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"image_digest" varchar(71) NOT NULL,
	"image_reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_releases_digest_check" CHECK ("application_releases"."image_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "application_releases_commit_check" CHECK ("application_releases"."commit_sha" ~ '^[a-f0-9]{7,64}$')
);
--> statement-breakpoint
CREATE TABLE "container_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"host" varchar(253) NOT NULL,
	"username" varchar(255) NOT NULL,
	"token_encrypted" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployable_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"repository_url" text NOT NULL,
	"default_branch" varchar(255) DEFAULT 'main' NOT NULL,
	"dockerfile_path" text DEFAULT 'Dockerfile' NOT NULL,
	"build_context" text DEFAULT '.' NOT NULL,
	"image_repository" text NOT NULL,
	"registry_id" uuid NOT NULL,
	"auto_deploy" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployable_applications_slug_check" CHECK ("deployable_applications"."slug" ~ '^[a-z0-9][a-z0-9-]*$')
);
--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD COLUMN "release_id" uuid;--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD COLUMN "release_policy" varchar(24) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_releases" ADD CONSTRAINT "application_releases_application_id_deployable_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."deployable_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_registries" ADD CONSTRAINT "container_registries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployable_applications" ADD CONSTRAINT "deployable_applications_registry_id_container_registries_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."container_registries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployable_applications" ADD CONSTRAINT "deployable_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_releases_application_digest_uidx" ON "application_releases" USING btree ("application_id","image_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "application_releases_application_version_uidx" ON "application_releases" USING btree ("application_id","version");--> statement-breakpoint
CREATE INDEX "application_releases_application_created_idx" ON "application_releases" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "container_registries_host_uidx" ON "container_registries" USING btree ("host");--> statement-breakpoint
CREATE INDEX "container_registries_active_idx" ON "container_registries" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "deployable_applications_slug_uidx" ON "deployable_applications" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "deployable_applications_image_repository_uidx" ON "deployable_applications" USING btree ("image_repository");--> statement-breakpoint
CREATE INDEX "deployable_applications_registry_id_idx" ON "deployable_applications" USING btree ("registry_id");--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD CONSTRAINT "infrastructure_resources_application_id_deployable_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."deployable_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD CONSTRAINT "infrastructure_resources_release_id_application_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."application_releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "infrastructure_resources_application_id_idx" ON "infrastructure_resources" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "infrastructure_resources_release_id_idx" ON "infrastructure_resources" USING btree ("release_id");--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD CONSTRAINT "infrastructure_resources_release_policy_check" CHECK ("infrastructure_resources"."release_policy" in ('manual', 'track_latest'));