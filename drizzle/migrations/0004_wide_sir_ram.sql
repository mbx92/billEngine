ALTER TABLE "plans" ADD COLUMN "included_resource_count" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "included_cpu_cores" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "included_memory_bytes" bigint;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "plan_resource_count" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "plan_cpu_cores" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "plan_memory_bytes" bigint;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_resource_count_check" CHECK ("plans"."included_resource_count" is null or "plans"."included_resource_count" > 0);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_cpu_cores_check" CHECK ("plans"."included_cpu_cores" is null or "plans"."included_cpu_cores" > 0);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_memory_bytes_check" CHECK ("plans"."included_memory_bytes" is null or "plans"."included_memory_bytes" > 0);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_plan_resource_count_check" CHECK ("services"."plan_resource_count" is null or "services"."plan_resource_count" > 0);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_plan_cpu_cores_check" CHECK ("services"."plan_cpu_cores" is null or "services"."plan_cpu_cores" > 0);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_plan_memory_bytes_check" CHECK ("services"."plan_memory_bytes" is null or "services"."plan_memory_bytes" > 0);