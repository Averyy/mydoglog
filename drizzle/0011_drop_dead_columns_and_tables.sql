-- Drop dead columns from poop_logs
ALTER TABLE "poop_logs" DROP COLUMN IF EXISTS "color";
ALTER TABLE "poop_logs" DROP COLUMN IF EXISTS "urgency";
ALTER TABLE "poop_logs" DROP COLUMN IF EXISTS "photo_url";

-- Drop dead column from itchiness_logs
ALTER TABLE "itchiness_logs" DROP COLUMN IF EXISTS "photo_url";

-- Drop dead column from feeding_periods
ALTER TABLE "feeding_periods" DROP COLUMN IF EXISTS "notes";

-- Drop dead tables
DROP TABLE IF EXISTS "symptom_logs";
DROP TABLE IF EXISTS "accidental_exposures";

-- Drop dead enums
DROP TYPE IF EXISTS "poop_color";
DROP TYPE IF EXISTS "time_since_meal";
DROP TYPE IF EXISTS "symptom_type";
DROP TYPE IF EXISTS "symptom_severity";
