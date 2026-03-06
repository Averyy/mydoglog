ALTER TABLE "food_scorecards" ALTER COLUMN "poop_quality" SET DATA TYPE integer[]
  USING CASE WHEN "poop_quality" IS NOT NULL THEN ARRAY["poop_quality"] ELSE NULL END;