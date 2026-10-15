CREATE TABLE "infrastructure_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"environment" varchar(64) DEFAULT 'staging' NOT NULL,
	"status" varchar(24) DEFAULT 'enrolling' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_draining" boolean DEFAULT false NOT NULL,
	"agent_version" varchar(64),
	"protocol_version" varchar(32),
	"os_release" varchar(160),
	"architecture" varchar(32),
	"docker_version" varchar(64),
	"compose_version" varchar(64),
	"capacity_cpu_milli" integer,
	"capacity_memory_bytes" bigint,
	"capacity_disk_bytes" bigint,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_inventory_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infrastructure_nodes_status_check" CHECK ("infrastructure_nodes"."status" in ('enrolling', 'online', 'degraded', 'offline', 'revoked', 'unknown')),
	CONSTRAINT "infrastructure_nodes_capacity_check" CHECK (("infrastructure_nodes"."capacity_cpu_milli" is null or "infrastructure_nodes"."capacity_cpu_milli" > 0)
        and ("infrastructure_nodes"."capacity_memory_bytes" is null or "infrastructure_nodes"."capacity_memory_bytes" > 0)
        and ("infrastructure_nodes"."capacity_disk_bytes" is null or "infrastructure_nodes"."capacity_disk_bytes" > 0))
);
--> statement-breakpoint
CREATE TABLE "infrastructure_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"resource_id" uuid,
	"actor_user_id" uuid,
	"idempotency_key" varchar(200) NOT NULL,
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar(100) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"expected_resource_revision" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(160),
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" varchar(64),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infrastructure_operations_status_check" CHECK ("infrastructure_operations"."status" in ('queued', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "infrastructure_operations_attempts_check" CHECK ("infrastructure_operations"."attempt_count" >= 0 and "infrastructure_operations"."max_attempts" > 0 and "infrastructure_operations"."attempt_count" <= "infrastructure_operations"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "infrastructure_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"customer_id" uuid,
	"external_id" varchar(200) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"name" varchar(255) NOT NULL,
	"classification" "resource_classification" DEFAULT 'billable' NOT NULL,
	"desired_state" varchar(24) DEFAULT 'pending' NOT NULL,
	"observed_state" varchar(24) DEFAULT 'unknown' NOT NULL,
	"desired_revision" integer DEFAULT 1 NOT NULL,
	"observed_revision" integer DEFAULT 0 NOT NULL,
	"image_reference" text,
	"image_digest" varchar(255),
	"desired_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_spec" jsonb,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_observed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infrastructure_resources_kind_check" CHECK ("infrastructure_resources"."kind" in ('application', 'database', 'volume')),
	CONSTRAINT "infrastructure_resources_desired_state_check" CHECK ("infrastructure_resources"."desired_state" in ('pending', 'running', 'stopped', 'restarting', 'degraded', 'deleting', 'deleted', 'failed', 'unknown')),
	CONSTRAINT "infrastructure_resources_observed_state_check" CHECK ("infrastructure_resources"."observed_state" in ('pending', 'running', 'stopped', 'restarting', 'degraded', 'deleting', 'deleted', 'failed', 'unknown')),
	CONSTRAINT "infrastructure_resources_revision_check" CHECK ("infrastructure_resources"."desired_revision" > 0 and "infrastructure_resources"."observed_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "node_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_name" varchar(160) NOT NULL,
	"environment" varchar(64) DEFAULT 'staging' NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"credential_hash" varchar(128) NOT NULL,
	"fingerprint" varchar(160) NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"observed_revision" integer NOT NULL,
	"state" varchar(24) NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_observations_revision_check" CHECK ("resource_observations"."observed_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resource_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"target_port" integer NOT NULL,
	"tls_enabled" boolean DEFAULT true NOT NULL,
	"billing_gate_enabled" boolean DEFAULT false NOT NULL,
	"middleware" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"desired_status" varchar(24) DEFAULT 'pending' NOT NULL,
	"observed_status" varchar(24) DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_routes_target_port_check" CHECK ("resource_routes"."target_port" between 1 and 65535)
);
--> statement-breakpoint
CREATE TABLE "resource_secret_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"environment_key" varchar(255) NOT NULL,
	"secret_reference" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_secret_references_version_check" CHECK ("resource_secret_references"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "resource_volumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"name" varchar(255) NOT NULL,
	"mount_target" text NOT NULL,
	"kind" varchar(24) DEFAULT 'persistent' NOT NULL,
	"delete_protection" boolean DEFAULT true NOT NULL,
	"retention_days" integer,
	"backup_policy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_volumes_kind_check" CHECK ("resource_volumes"."kind" in ('ephemeral', 'persistent')),
	CONSTRAINT "resource_volumes_retention_check" CHECK ("resource_volumes"."retention_days" is null or "resource_volumes"."retention_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_resources" ADD COLUMN "infrastructure_resource_id" uuid;--> statement-breakpoint
ALTER TABLE "infrastructure_operations" ADD CONSTRAINT "infrastructure_operations_node_id_infrastructure_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."infrastructure_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_operations" ADD CONSTRAINT "infrastructure_operations_resource_id_infrastructure_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."infrastructure_resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_operations" ADD CONSTRAINT "infrastructure_operations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD CONSTRAINT "infrastructure_resources_node_id_infrastructure_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."infrastructure_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD CONSTRAINT "infrastructure_resources_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_enrollments" ADD CONSTRAINT "node_enrollments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_identities" ADD CONSTRAINT "node_identities_node_id_infrastructure_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."infrastructure_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_observations" ADD CONSTRAINT "resource_observations_node_id_infrastructure_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."infrastructure_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_observations" ADD CONSTRAINT "resource_observations_resource_id_infrastructure_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."infrastructure_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_routes" ADD CONSTRAINT "resource_routes_resource_id_infrastructure_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."infrastructure_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_secret_references" ADD CONSTRAINT "resource_secret_references_resource_id_infrastructure_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."infrastructure_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_volumes" ADD CONSTRAINT "resource_volumes_node_id_infrastructure_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."infrastructure_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_volumes" ADD CONSTRAINT "resource_volumes_resource_id_infrastructure_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."infrastructure_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_nodes_name_environment_uidx" ON "infrastructure_nodes" USING btree ("name","environment");--> statement-breakpoint
CREATE INDEX "infrastructure_nodes_status_idx" ON "infrastructure_nodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "infrastructure_nodes_heartbeat_idx" ON "infrastructure_nodes" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_operations_idempotency_uidx" ON "infrastructure_operations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "infrastructure_operations_dispatch_idx" ON "infrastructure_operations" USING btree ("node_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "infrastructure_operations_resource_id_idx" ON "infrastructure_operations" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "infrastructure_operations_correlation_id_idx" ON "infrastructure_operations" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_resources_node_external_uidx" ON "infrastructure_resources" USING btree ("node_id","external_id");--> statement-breakpoint
CREATE INDEX "infrastructure_resources_node_id_idx" ON "infrastructure_resources" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "infrastructure_resources_customer_id_idx" ON "infrastructure_resources" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "infrastructure_resources_kind_idx" ON "infrastructure_resources" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "infrastructure_resources_observed_state_idx" ON "infrastructure_resources" USING btree ("observed_state");--> statement-breakpoint
CREATE INDEX "infrastructure_resources_last_observed_idx" ON "infrastructure_resources" USING btree ("last_observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "node_enrollments_token_hash_uidx" ON "node_enrollments" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "node_enrollments_expires_at_idx" ON "node_enrollments" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "node_identities_credential_hash_uidx" ON "node_identities" USING btree ("credential_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "node_identities_fingerprint_uidx" ON "node_identities" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "node_identities_node_id_idx" ON "node_identities" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "resource_observations_resource_observed_idx" ON "resource_observations" USING btree ("resource_id","observed_at");--> statement-breakpoint
CREATE INDEX "resource_observations_node_observed_idx" ON "resource_observations" USING btree ("node_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_routes_hostname_uidx" ON "resource_routes" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "resource_routes_resource_id_idx" ON "resource_routes" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_secret_references_key_uidx" ON "resource_secret_references" USING btree ("resource_id","environment_key");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_volumes_node_external_uidx" ON "resource_volumes" USING btree ("node_id","external_id");--> statement-breakpoint
CREATE INDEX "resource_volumes_resource_id_idx" ON "resource_volumes" USING btree ("resource_id");--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_infrastructure_resource_id_infrastructure_resources_id_fk" FOREIGN KEY ("infrastructure_resource_id") REFERENCES "public"."infrastructure_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_resources_infrastructure_resource_id_idx" ON "service_resources" USING btree ("infrastructure_resource_id");