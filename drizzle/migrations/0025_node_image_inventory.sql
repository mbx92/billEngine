ALTER TABLE "infrastructure_nodes" ADD COLUMN "image_inventory" jsonb DEFAULT '[]'::jsonb NOT NULL;
