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
  uniqueIndex,
} from "drizzle-orm/pg-core"

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const productTypeEnum = pgEnum("product_type", [
  "food",
  "treat",
  "supplement",
])

export const productFormatEnum = pgEnum("product_format", [
  "dry",
  "wet",
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



export const medicationCategoryEnum = pgEnum("medication_category", [
  "allergy",
  "parasite",
  "gi",
  "pain",
  "steroid",
])

export const dosageFormEnum = pgEnum("dosage_form", [
  "tablet",
  "chewable",
  "capsule",
  "liquid",
  "injection",
  "topical",
  "spray",
  "powder",
  "granules",
  "gel",
  "collar",
])

export const dosingIntervalEnum = pgEnum("dosing_interval", [
  "four_times_daily",
  "three_times_daily",
  "twice_daily",
  "daily",
  "every_other_day",
  "weekly",
  "biweekly",
  "monthly",
  "every_6_weeks",
  "every_8_weeks",
  "every_12_weeks",
  "every_3_months",
  "every_6_months",
  "every_8_months",
  "annually",
  "as_needed",
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
    type: productTypeEnum("type").notNull(),
    format: productFormatEnum("format").notNull(),
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
    slug: text("slug").notNull(),
    breed: text("breed"),
    birthDate: date("birth_date"),
    weightKg: numeric("weight_kg"),
    environmentEnabled: boolean("environment_enabled").notNull().default(false),
    mealsPerDay: integer("meals_per_day").notNull().default(3),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_dogs_owner").on(table.ownerId),
    uniqueIndex("idx_dogs_owner_slug").on(table.ownerId, table.slug),
  ],
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
    transitionDays: integer("transition_days"),
    previousPlanGroupId: text("previous_plan_group_id"),
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
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_poop_logs_dog_date").on(table.dogId, table.date)],
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
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_itchiness_logs_dog_date").on(table.dogId, table.date)],
)

export const medicationProducts = pgTable("medication_products", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  genericName: text("generic_name").notNull(),
  manufacturer: text("manufacturer"),
  category: medicationCategoryEnum("category").notNull(),
  drugClass: text("drug_class"),
  dosageForm: dosageFormEnum("dosage_form").notNull(),
  defaultIntervals: dosingIntervalEnum("default_intervals").array().notNull(),
  description: text("description"),
  commonSideEffects: text("common_side_effects"),
  sideEffectsSources: text("side_effects_sources"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

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
    medicationProductId: text("medication_product_id").references(
      () => medicationProducts.id,
    ),
    interval: dosingIntervalEnum("interval"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_medications_dog").on(table.dogId)],
)

export const dailyPollen = pgTable(
  "daily_pollen",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    provider: text("provider").notNull(),
    location: text("location").notNull(),
    date: date("date").notNull(),
    pollenLevel: integer("pollen_level").notNull(),
    sporeLevel: integer("spore_level"),
    totalTrees: integer("total_trees"),
    totalGrasses: integer("total_grasses"),
    totalWeeds: integer("total_weeds"),
    topAllergens: jsonb("top_allergens"),
    source: text("source").notNull(),
    outOfSeason: boolean("out_of_season").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_daily_pollen_provider_location_date").on(
      table.provider,
      table.location,
      table.date,
    ),
  ],
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
export type ItchinessLog = typeof itchinessLogs.$inferSelect
export type MedicationProduct = typeof medicationProducts.$inferSelect
export type Medication = typeof medications.$inferSelect
export type FoodScorecard = typeof foodScorecards.$inferSelect
export type MealSlot = (typeof mealSlotEnum.enumValues)[number]
export type QuantityUnit = (typeof quantityUnitEnum.enumValues)[number]
