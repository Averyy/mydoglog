import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const productTypeEnum = pgEnum("product_type", [
  "dry_food",
  "wet_food",
  "treat",
  "topper",
  "supplement",
  "probiotic",
  "freeze_dried",
  "whole_food",
])

export const productChannelEnum = pgEnum("product_channel", [
  "retail",
  "vet",
  "seed",
])

export const ingredientCategoryEnum = pgEnum("ingredient_category", [
  "protein",
  "carb",
  "fat",
  "fiber",
  "vitamin",
  "mineral",
  "additive",
])

export const ingredientFormEnum = pgEnum("ingredient_form", [
  "raw",
  "meal",
  "by_product",
  "fat",
  "oil",
  "hydrolyzed",
  "flour",
  "bran",
  "protein_isolate",
  "starch",
  "fiber",
  "gluten",
])

export const ingredientSourceGroupEnum = pgEnum("ingredient_source_group", [
  "poultry",
  "red_meat",
  "fish",
  "grain",
  "legume",
  "root",
  "fruit",
  "dairy",
  "egg",
  "other",
  "additive",
  "fiber",
  "vegetable",
  "seed",
])

export const mealSlotEnum = pgEnum("meal_slot", [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
])

export const quantityUnitEnum = pgEnum("quantity_unit", [
  "can",
  "cup",
  "g",
  "scoop",
  "piece",
  "tbsp",
  "tsp",
  "ml",
  "treat",
])


export const itchinessImpactEnum = pgEnum("itchiness_impact", [
  "better",
  "no_change",
  "worse",
])


export const poopColorEnum = pgEnum("poop_color", [
  "brown",
  "dark_brown",
  "black",
  "red",
  "orange",
  "yellow",
  "green",
  "grey",
  "white_spots",
])

export const vomitTypeEnum = pgEnum("vomit_type", ["vomiting", "regurgitation", "bile"])

export const timeSinceMealEnum = pgEnum("time_since_meal", [
  "lt_30min",
  "1_2hr",
  "3_6hr",
  "6plus_hr",
  "empty_stomach",
])

export const symptomTypeEnum = pgEnum("symptom_type", [
  "gas",
  "ear_issue",
  "scooting",
  "hot_spot",
  "grass_eating",
  "lethargy",
  "appetite_change",
  "coat_issue",
  "other",
])

export const symptomSeverityEnum = pgEnum("symptom_severity", [
  "mild",
  "moderate",
  "severe",
])

export const medicationReasonEnum = pgEnum("medication_reason", [
  "itchiness",
  "digestive",
  "other",
])

// ---------------------------------------------------------------------------
// Auth tables (Better Auth managed)
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
})

// ---------------------------------------------------------------------------
// Product tables (scraper-written, app-readonly)
// ---------------------------------------------------------------------------

export const brands = pgTable("brands", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  websiteUrl: text("website_url"),
  country: text("country"),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const products = pgTable(
  "products",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    type: productTypeEnum("type"),
    channel: productChannelEnum("channel"),
    lifestage: text("lifestage"),
    healthTags: text("health_tags").array(),
    rawIngredientString: text("raw_ingredient_string"),
    guaranteedAnalysis: jsonb("guaranteed_analysis"),
    calorieContent: text("calorie_content"),
    imageUrls: text("image_urls").array(),
    manufacturerUrl: text("manufacturer_url"),
    variantsJson: jsonb("variants_json"),
    scrapedFrom: text("scraped_from"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }),
    isDiscontinued: boolean("is_discontinued").notNull().default(false),
    discontinuedAt: timestamp("discontinued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_product_name_brand").on(table.name, table.brandId),
    index("idx_product_name").on(table.name),
    index("idx_product_brand").on(table.brandId),
  ],
)

export const ingredients = pgTable(
  "ingredients",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    normalizedName: text("normalized_name").notNull().unique(),
    aliases: text("aliases").array(),
    category: ingredientCategoryEnum("category"),
    family: text("family"),
    sourceGroup: ingredientSourceGroupEnum("source_group"),
    formType: ingredientFormEnum("form_type"),
    isHydrolyzed: boolean("is_hydrolyzed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_ingredient_normalized_name").on(table.normalizedName)],
)

export const productIngredients = pgTable(
  "product_ingredients",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [
    unique("uq_product_ingredient").on(table.productId, table.ingredientId),
    index("idx_product_ingredients_product").on(table.productId),
  ],
)

export const ingredientCrossReactivity = pgTable("ingredient_cross_reactivity", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  groupName: text("group_name").notNull().unique(),
  families: text("families").array().notNull(),
})

// ---------------------------------------------------------------------------
// User tables
// ---------------------------------------------------------------------------

export const dogs = pgTable(
  "dogs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    breed: text("breed"),
    birthDate: date("birth_date"),
    weightKg: numeric("weight_kg"),
    location: text("location"),
    postalCode: text("postal_code"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_dogs_owner").on(table.ownerId)],
)

// ---------------------------------------------------------------------------
// Log tables (all have date + nullable datetime pattern)
// ---------------------------------------------------------------------------

export const feedingPeriods = pgTable(
  "feeding_periods",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    mealSlot: mealSlotEnum("meal_slot"),
    quantity: numeric("quantity").notNull(),
    quantityUnit: quantityUnitEnum("quantity_unit").notNull(),
    planGroupId: text("plan_group_id").notNull(),
    planName: text("plan_name"),
    isBackfill: boolean("is_backfill").notNull().default(false),
    approximateDuration: text("approximate_duration"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_feeding_periods_dog").on(table.dogId),
    index("idx_feeding_periods_plan_group").on(table.dogId, table.planGroupId),
    index("idx_feeding_periods_dog_start_created").on(table.dogId, table.startDate, table.createdAt),
  ],
)

export const treatLogs = pgTable(
  "treat_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    date: date("date").notNull(),
    datetime: timestamp("datetime", { withTimezone: true }),
    quantity: numeric("quantity").notNull(),
    quantityUnit: quantityUnitEnum("quantity_unit").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_treat_logs_dog_date").on(table.dogId, table.date)],
)

export const foodScorecards = pgTable(
  "food_scorecards",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    planGroupId: text("plan_group_id").notNull(),
    poopQuality: integer("poop_quality").array(),
    itchSeverity: integer("itch_severity").array(),
    digestiveImpact: itchinessImpactEnum("digestive_impact"),
    itchinessImpact: itchinessImpactEnum("itchiness_impact"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_food_scorecards_plan_group").on(table.planGroupId)],
)

export const poopLogs = pgTable(
  "poop_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    datetime: timestamp("datetime", { withTimezone: true }),
    firmnessScore: integer("firmness_score").notNull(),
    color: poopColorEnum("color"),
    urgency: boolean("urgency"),
    photoUrl: text("photo_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_poop_logs_dog_date").on(table.dogId, table.date)],
)

export const vomitLogs = pgTable(
  "vomit_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    datetime: timestamp("datetime", { withTimezone: true }),
    type: vomitTypeEnum("type"),
    timeSinceMeal: timeSinceMealEnum("time_since_meal"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_vomit_logs_dog_date").on(table.dogId, table.date)],
)

export const itchinessLogs = pgTable(
  "itchiness_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    datetime: timestamp("datetime", { withTimezone: true }),
    score: integer("score").notNull(),
    bodyAreas: text("body_areas").array(),
    photoUrl: text("photo_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_itchiness_logs_dog_date").on(table.dogId, table.date)],
)

export const symptomLogs = pgTable(
  "symptom_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    datetime: timestamp("datetime", { withTimezone: true }),
    type: symptomTypeEnum("type"),
    severity: symptomSeverityEnum("severity"),
    photoUrl: text("photo_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_symptom_logs_dog_date").on(table.dogId, table.date)],
)

export const accidentalExposures = pgTable(
  "accidental_exposures",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    datetime: timestamp("datetime", { withTimezone: true }).notNull(),
    description: text("description"),
    ingredientIds: text("ingredient_ids").array(),
    freeTextIngredients: text("free_text_ingredients"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_exposures_dog_date").on(table.dogId, table.date)],
)

export const medications = pgTable(
  "medications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dosage: text("dosage"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    reason: medicationReasonEnum("reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_medications_dog").on(table.dogId)],
)

export const pollenLogs = pgTable(
  "pollen_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    location: text("location").notNull(),
    date: date("date").notNull(),
    pollenIndex: numeric("pollen_index"),
    pollenTypes: jsonb("pollen_types"),
    sourceApi: text("source_api"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_pollen_logs_location_date").on(table.location, table.date)],
)

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type User = typeof user.$inferSelect
export type Brand = typeof brands.$inferSelect
export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert
export type Ingredient = typeof ingredients.$inferSelect
export type ProductIngredient = typeof productIngredients.$inferSelect
export type Dog = typeof dogs.$inferSelect
export type NewDog = typeof dogs.$inferInsert
export type FeedingPeriod = typeof feedingPeriods.$inferSelect
export type PoopLog = typeof poopLogs.$inferSelect
export type VomitLog = typeof vomitLogs.$inferSelect
export type ItchinessLog = typeof itchinessLogs.$inferSelect
export type SymptomLog = typeof symptomLogs.$inferSelect
export type Medication = typeof medications.$inferSelect
export type FoodScorecard = typeof foodScorecards.$inferSelect
