ALTER TABLE "deployable_applications" ALTER COLUMN "registry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "application_releases" ADD COLUMN "local_node_id" uuid;--> statement-breakpoint
-- Preserve existing registry applications before setting the default for new applications.
ALTER TABLE "deployable_applications" ADD COLUMN "image_storage" varchar(24) DEFAULT 'registry' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployable_applications" ALTER COLUMN "image_storage" SET DEFAULT 'local';--> statement-breakpoint
ALTER TABLE "deployable_applications" ADD COLUMN "build_node_id" uuid;--> statement-breakpoint
ALTER TABLE "application_releases" ADD CONSTRAINT "application_releases_local_node_id_infrastructure_nodes_id_fk" FOREIGN KEY ("local_node_id") REFERENCES "public"."infrastructure_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployable_applications" ADD CONSTRAINT "deployable_applications_build_node_id_infrastructure_nodes_id_fk" FOREIGN KEY ("build_node_id") REFERENCES "public"."infrastructure_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployable_applications" ADD CONSTRAINT "deployable_applications_image_storage_check" CHECK (("deployable_applications"."image_storage" = 'local' and "deployable_applications"."build_node_id" is not null and "deployable_applications"."registry_id" is null) or ("deployable_applications"."image_storage" = 'registry' and "deployable_applications"."registry_id" is not null and "deployable_applications"."build_node_id" is null));
