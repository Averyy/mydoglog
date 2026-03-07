ALTER TABLE "food_scorecards" DROP COLUMN "vomiting";--> statement-breakpoint
ALTER TABLE "food_scorecards" DROP COLUMN "palatability";--> statement-breakpoint
ALTER TABLE "food_scorecards" DROP COLUMN "verdict";--> statement-breakpoint
ALTER TABLE "food_scorecards" DROP COLUMN "primary_reason";--> statement-breakpoint
DROP TYPE "public"."palatability";--> statement-breakpoint
DROP TYPE "public"."primary_reason";--> statement-breakpoint
DROP TYPE "public"."verdict";--> statement-breakpoint
DROP TYPE "public"."vomiting_freq";