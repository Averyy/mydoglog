ALTER TABLE "vomit_logs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "vomit_logs" CASCADE;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "format" SET NOT NULL;--> statement-breakpoint
DROP TYPE "public"."vomit_type";