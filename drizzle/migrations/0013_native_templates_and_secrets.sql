CREATE TABLE "infrastructure_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"category" varchar(32) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infrastructure_templates_category_check" CHECK ("infrastructure_templates"."category" in ('application', 'database', 'cache')),
	CONSTRAINT "infrastructure_templates_version_check" CHECK ("infrastructure_templates"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD COLUMN "template_version" integer;--> statement-breakpoint
ALTER TABLE "resource_secret_references" ADD COLUMN "encrypted_value" text;--> statement-breakpoint
ALTER TABLE "resource_secret_references" ADD COLUMN "delivery" varchar(24) DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "infrastructure_templates" ADD CONSTRAINT "infrastructure_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infrastructure_templates_slug_uidx" ON "infrastructure_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "infrastructure_templates_active_category_idx" ON "infrastructure_templates" USING btree ("is_active","category");--> statement-breakpoint
ALTER TABLE "infrastructure_resources" ADD CONSTRAINT "infrastructure_resources_template_id_infrastructure_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."infrastructure_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "infrastructure_resources_template_id_idx" ON "infrastructure_resources" USING btree ("template_id");--> statement-breakpoint
ALTER TABLE "resource_secret_references" ADD CONSTRAINT "resource_secret_references_delivery_check" CHECK ("resource_secret_references"."delivery" in ('file'));
--> statement-breakpoint
INSERT INTO "infrastructure_templates" ("slug", "name", "description", "category", "version", "definition", "is_builtin") VALUES
(
  'postgresql',
  'PostgreSQL',
  'Database PostgreSQL terisolasi dengan database, user, password, port, dan volume persisten sendiri.',
  'database',
  1,
  '{"engine":"postgresql","resourceKind":"database","spec":{"source":{"type":"image","reference":"postgres:17-alpine"},"limits":{"cpuMilli":500,"memoryBytes":"536870912"},"ports":[{"containerPort":5432,"protocol":"tcp"}],"volumes":[{"name":"data","mountTarget":"/var/lib/postgresql/data","kind":"persistent"}],"restartPolicy":"unless-stopped"},"parameters":[{"key":"database","label":"Database","environmentKey":"POSTGRES_DB","type":"string","required":true,"generated":false,"defaultValue":"app"},{"key":"username","label":"Username","environmentKey":"POSTGRES_USER","type":"string","required":true,"generated":false,"defaultValue":"app"},{"key":"password","label":"Password","environmentKey":"POSTGRES_PASSWORD","type":"secret","required":true,"generated":true,"help":"Kosongkan agar password kuat dibuat otomatis."}]}'::jsonb,
  true
),
(
  'mysql',
  'MySQL',
  'Database MySQL terisolasi dengan database, user, password, port, dan volume persisten sendiri.',
  'database',
  1,
  '{"engine":"mysql","resourceKind":"database","spec":{"source":{"type":"image","reference":"mysql:8.4"},"limits":{"cpuMilli":500,"memoryBytes":"536870912"},"ports":[{"containerPort":3306,"protocol":"tcp"}],"volumes":[{"name":"data","mountTarget":"/var/lib/mysql","kind":"persistent"}],"restartPolicy":"unless-stopped"},"parameters":[{"key":"database","label":"Database","environmentKey":"MYSQL_DATABASE","type":"string","required":true,"generated":false,"defaultValue":"app"},{"key":"username","label":"Username","environmentKey":"MYSQL_USER","type":"string","required":true,"generated":false,"defaultValue":"app"},{"key":"password","label":"Password","environmentKey":"MYSQL_PASSWORD","type":"secret","required":true,"generated":true,"help":"Kosongkan agar password kuat dibuat otomatis."},{"key":"rootPassword","label":"Root password","environmentKey":"MYSQL_ROOT_PASSWORD","type":"secret","required":true,"generated":true,"help":"Kosongkan agar root password dibuat otomatis."}]}'::jsonb,
  true
),
(
  'redis',
  'Redis',
  'Redis dedicated per aplikasi dengan password dan volume persisten.',
  'cache',
  1,
  '{"engine":"redis","resourceKind":"database","spec":{"source":{"type":"image","reference":"bitnami/redis:7.4"},"limits":{"cpuMilli":250,"memoryBytes":"268435456"},"ports":[{"containerPort":6379,"protocol":"tcp"}],"volumes":[{"name":"data","mountTarget":"/bitnami/redis/data","kind":"persistent"}],"restartPolicy":"unless-stopped"},"parameters":[{"key":"password","label":"Password","environmentKey":"REDIS_PASSWORD","type":"secret","required":true,"generated":true,"help":"Kosongkan agar password kuat dibuat otomatis."}]}'::jsonb,
  true
)
ON CONFLICT ("slug") DO NOTHING;
