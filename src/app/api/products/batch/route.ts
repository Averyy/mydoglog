import { NextRequest, NextResponse } from "next/server"
import { db, products, brands, productIngredients, ingredients } from "@/lib/db"
import { eq, inArray, asc, sql } from "drizzle-orm"
import type { ProductDetail } from "@/lib/types"

const MAX_IDS = 4
const MAX_ID_LENGTH = 100

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as { ids?: unknown }
    const ids = body.ids

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
      return NextResponse.json(
        { error: `Provide 1-${MAX_IDS} product IDs` },
        { status: 400 },
      )
    }

    if (!ids.every((id): id is string => typeof id === "string" && id.length <= MAX_ID_LENGTH)) {
      return NextResponse.json({ error: "IDs must be strings" }, { status: 400 })
    }

    // Fetch products + ingredients in parallel
    const [productRows, allIngs] = await Promise.all([
      db
        .select({
          id: products.id,
          name: products.name,
          brandName: brands.name,
          brandId: products.brandId,
          type: products.type,
          format: products.format,
          channel: products.channel,
          lifestage: products.lifestage,
          imageUrl: sql<string | null>`${products.imageUrls}[1]`,
          isDiscontinued: products.isDiscontinued,
          calorieContent: products.calorieContent,
          healthTags: products.healthTags,
          guaranteedAnalysis: products.guaranteedAnalysis,
          guaranteedAnalysisBasis: products.guaranteedAnalysisBasis,
          rawIngredientString: products.rawIngredientString,
        })
        .from(products)
        .innerJoin(brands, eq(products.brandId, brands.id))
        .where(inArray(products.id, ids)),
      db
        .select({
          productId: productIngredients.productId,
          normalizedName: ingredients.normalizedName,
          position: productIngredients.position,
        })
        .from(productIngredients)
        .innerJoin(ingredients, eq(productIngredients.ingredientId, ingredients.id))
        .where(inArray(productIngredients.productId, ids))
        .orderBy(asc(productIngredients.position)),
    ])

    // Group ingredients by product
    const ingsByProduct = new Map<string, { normalizedName: string; position: number }[]>()
    for (const ing of allIngs) {
      const list = ingsByProduct.get(ing.productId) ?? []
      list.push({ normalizedName: ing.normalizedName, position: ing.position })
      ingsByProduct.set(ing.productId, list)
    }

    // Assemble response, preserving request order
    const productMap = new Map(productRows.map((p) => [p.id, p]))
    const items: ProductDetail[] = []
    const missingIds: string[] = []
    for (const id of ids) {
      const p = productMap.get(id)
      if (!p) {
        missingIds.push(id)
        continue
      }
      items.push({
        id: p.id,
        name: p.name,
        brandName: p.brandName,
        brandId: p.brandId,
        type: p.type,
        format: p.format,
        channel: p.channel,
        lifestage: p.lifestage,
        imageUrl: p.imageUrl,
        isDiscontinued: p.isDiscontinued,
        calorieContent: p.calorieContent,
        healthTags: p.healthTags,
        guaranteedAnalysis: (p.guaranteedAnalysis as Record<string, number>) ?? null,
        guaranteedAnalysisBasis: p.guaranteedAnalysisBasis,
        rawIngredientString: p.rawIngredientString,
        ingredients: ingsByProduct.get(p.id) ?? [],
      })
    }

    return NextResponse.json({ items, missingIds })
  } catch (error) {
    console.error("Error fetching batch products:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
