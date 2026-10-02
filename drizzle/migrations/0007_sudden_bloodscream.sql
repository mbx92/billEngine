CREATE TABLE "deployment_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coolify_server_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"repository_url" text NOT NULL,
	"branch" varchar(255) DEFAULT 'main' NOT NULL,
	"build_pack" varchar(32) NOT NULL,
	"project_uuid" varchar(160) NOT NULL,
	"target_server_uuid" varchar(160) NOT NULL,
	"environment_name" varchar(160) DEFAULT 'production' NOT NULL,
	"destination_uuid" varchar(160),
	"base_directory" text,
	"dockerfile_location" text,
	"docker_compose_location" text,
	"compose_service_name" varchar(160),
	"ports_exposes" varchar(255),
	"healthcheck_path" text,
	"healthcheck_port" varchar(32),
	"environment_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_labels" text,
	"billing_gate_enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provisioning_job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"stage" varchar(40) NOT NULL,
	"level" varchar(16) DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provisioning_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blueprint_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"requested_by" uuid,
	"status" varchar(40) DEFAULT 'queued' NOT NULL,
	"failed_stage" varchar(40),
	"application_name" varchar(255) NOT NULL,
	"hostname" varchar(253),
	"domain_type" varchar(32),
	"environment_encrypted" text,
	"coolify_application_uuid" varchar(160),
	"coolify_deployment_uuid" varchar(160),
	"resource_id" uuid,
	"domain_id" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment_blueprints" ADD CONSTRAINT "deployment_blueprints_coolify_server_id_coolify_servers_id_fk" FOREIGN KEY ("coolify_server_id") REFERENCES "public"."coolify_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_blueprints" ADD CONSTRAINT "deployment_blueprints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_job_events" ADD CONSTRAINT "provisioning_job_events_job_id_provisioning_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."provisioning_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_blueprint_id_deployment_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."deployment_blueprints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_resource_id_coolify_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."coolify_resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_domain_id_resource_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."resource_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_blueprints_slug_uidx" ON "deployment_blueprints" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "deployment_blueprints_server_id_idx" ON "deployment_blueprints" USING btree ("coolify_server_id");--> statement-breakpoint
CREATE INDEX "deployment_blueprints_active_idx" ON "deployment_blueprints" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "provisioning_job_events_job_created_idx" ON "provisioning_job_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "provisioning_jobs_status_run_idx" ON "provisioning_jobs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "provisioning_jobs_service_id_idx" ON "provisioning_jobs" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "provisioning_jobs_blueprint_id_idx" ON "provisioning_jobs" USING btree ("blueprint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provisioning_jobs_application_uuid_uidx" ON "provisioning_jobs" USING btree ("coolify_application_uuid") WHERE "provisioning_jobs"."coolify_application_uuid" is not null;