CREATE TYPE "public"."billing_cycle" AS ENUM('one_time', 'monthly', 'quarterly', 'semi_annually', 'annually');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'unpaid', 'paid', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'completed', 'failed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."resource_classification" AS ENUM('billable', 'internal', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('running', 'stopped', 'restarting', 'degraded', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('active', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'customer');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coolify_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coolify_server_id" uuid NOT NULL,
	"coolify_uuid" varchar(160) NOT NULL,
	"resource_type" varchar(80) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "resource_status" DEFAULT 'unknown' NOT NULL,
	"classification" "resource_classification" DEFAULT 'billable' NOT NULL,
	"fqdn" text,
	"project_name" varchar(255),
	"environment_name" varchar(255),
	"limits_cpus" numeric(10, 3),
	"limits_cpuset" varchar(100),
	"limits_cpu_shares" integer,
	"limits_memory_bytes" bigint,
	"memory_reservation_bytes" bigint,
	"memory_swap_bytes" bigint,
	"raw_metadata" jsonb,
	"last_seen_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coolify_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"base_url" text NOT NULL,
	"status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"token_encrypted" text,
	"last_synced_at" timestamp with time zone,
	"last_sync_status" varchar(32),
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_number" varchar(32) NOT NULL,
	"name" varchar(160) NOT NULL,
	"company_name" varchar(200),
	"email" varchar(320) NOT NULL,
	"phone" varchar(40),
	"address_line_1" varchar(255),
	"address_line_2" varchar(255),
	"city" varchar(120),
	"province" varchar(120),
	"postal_code" varchar(20),
	"country_code" varchar(2) DEFAULT 'ID' NOT NULL,
	"tax_id" varchar(80),
	"status" "customer_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(14, 4) DEFAULT '1' NOT NULL,
	"unit_price_amount" bigint NOT NULL,
	"subtotal_amount" bigint NOT NULL,
	"tax_rate" numeric(7, 4),
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"total_amount" bigint NOT NULL,
	"service_period_start" date,
	"service_period_end" date,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_number" varchar(48) NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"subtotal_amount" bigint NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"total_amount" bigint NOT NULL,
	"amount_paid" bigint DEFAULT 0 NOT NULL,
	"balance_due" bigint NOT NULL,
	"customer_name" varchar(160) NOT NULL,
	"customer_company_name" varchar(200),
	"customer_email" varchar(320) NOT NULL,
	"customer_phone" varchar(40),
	"customer_address" text,
	"customer_tax_id" varchar(80),
	"seller_name" varchar(200) NOT NULL,
	"seller_address" text,
	"seller_email" varchar(320),
	"seller_tax_id" varchar(80),
	"notes" text,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_subtotal_amount_check" CHECK ("invoices"."subtotal_amount" >= 0),
	CONSTRAINT "invoices_tax_amount_check" CHECK ("invoices"."tax_amount" >= 0),
	CONSTRAINT "invoices_total_amount_check" CHECK ("invoices"."total_amount" >= 0),
	CONSTRAINT "invoices_amount_paid_check" CHECK ("invoices"."amount_paid" >= 0),
	CONSTRAINT "invoices_balance_due_check" CHECK ("invoices"."balance_due" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_billing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(160) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" uuid,
	"before_data" jsonb,
	"after_data" jsonb,
	"metadata" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_type" varchar(40) NOT NULL,
	"period_key" varchar(40) NOT NULL,
	"last_number" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" varchar(160) NOT NULL,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(160) NOT NULL,
	"value" jsonb NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_number" varchar(48) NOT NULL,
	"status" "payment_status" DEFAULT 'completed' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"method" varchar(80) NOT NULL,
	"reference" varchar(255),
	"notes" text,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "service_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_number" varchar(32) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"status" "service_status" DEFAULT 'active' NOT NULL,
	"currency" varchar(3) DEFAULT 'IDR' NOT NULL,
	"price_amount" bigint NOT NULL,
	"billing_cycle" "billing_cycle" NOT NULL,
	"billing_start_date" date NOT NULL,
	"next_due_date" date,
	"invoice_lead_days" integer DEFAULT 0 NOT NULL,
	"payment_due_days" integer DEFAULT 7 NOT NULL,
	"tax_rate" numeric(7, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "services_price_amount_check" CHECK ("services"."price_amount" >= 0),
	CONSTRAINT "services_due_days_check" CHECK ("services"."payment_due_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coolify_resources" ADD CONSTRAINT "coolify_resources_coolify_server_id_coolify_servers_id_fk" FOREIGN KEY ("coolify_server_id") REFERENCES "public"."coolify_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_billing_runs" ADD CONSTRAINT "service_billing_runs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_billing_runs" ADD CONSTRAINT "service_billing_runs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_resource_id_coolify_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."coolify_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uidx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_customer_id_idx" ON "users" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "coolify_resources_server_uuid_uidx" ON "coolify_resources" USING btree ("coolify_server_id","coolify_uuid");--> statement-breakpoint
CREATE INDEX "coolify_resources_server_id_idx" ON "coolify_resources" USING btree ("coolify_server_id");--> statement-breakpoint
CREATE INDEX "coolify_resources_status_idx" ON "coolify_resources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "coolify_resources_classification_idx" ON "coolify_resources" USING btree ("classification");--> statement-breakpoint
CREATE INDEX "coolify_resources_last_seen_at_idx" ON "coolify_resources" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_customer_number_uidx" ON "customers" USING btree ("customer_number");--> statement-breakpoint
CREATE INDEX "customers_status_idx" ON "customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_items_service_id_idx" ON "invoice_items" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_invoice_number_uidx" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_customer_id_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_due_date_idx" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "invoices_customer_status_idx" ON "invoices" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_billing_runs_service_period_uidx" ON "service_billing_runs" USING btree ("service_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "service_billing_runs_invoice_id_idx" ON "service_billing_runs" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequences_type_period_uidx" ON "document_sequences" USING btree ("document_type","period_key");--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_uidx" ON "settings" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_payment_number_uidx" ON "payments" USING btree ("payment_number");--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_paid_at_idx" ON "payments" USING btree ("paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_resources_service_resource_uidx" ON "service_resources" USING btree ("service_id","resource_id");--> statement-breakpoint
CREATE INDEX "service_resources_service_id_idx" ON "service_resources" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_resources_resource_id_idx" ON "service_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_service_number_uidx" ON "services" USING btree ("service_number");--> statement-breakpoint
CREATE INDEX "services_customer_id_idx" ON "services" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "services_status_idx" ON "services" USING btree ("status");--> statement-breakpoint
CREATE INDEX "services_next_due_date_idx" ON "services" USING btree ("next_due_date");--> statement-breakpoint
CREATE INDEX "services_customer_status_idx" ON "services" USING btree ("customer_id","status");