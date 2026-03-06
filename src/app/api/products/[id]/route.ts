import { NextRequest, NextResponse } from "next/server"
import { db, products, brands, productIngredients, ingredients } from "@/lib/db"
import { eq, asc } from "drizzle-orm"
import { findSaltPosition } from "@/lib/ingredients"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params

    const [product] = await db
      .select({
        id: products.id,
        name: products.name,
        brandId: products.brandId,
        brandName: brands.name,
        description: products.description,
        type: products.type,
        channel: products.channel,
        lifestage: products.lifestage,
        healthTags: products.healthTags,
        rawIngredientString: products.rawIngredientString,
        guaranteedAnalysis: products.guaranteedAnalysis,
        calorieContent: products.calorieContent,
        imageUrls: products.imageUrls,
        manufacturerUrl: products.manufacturerUrl,
        variantsJson: products.variantsJson,
        isDiscontinued: products.isDiscontinued,
      })
      .from(products)
      .innerJoin(brands, eq(products.brandId, brands.id))
      .where(eq(products.id, id))

    if (!product) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const productIngs = await db
      .select({
        position: productIngredients.position,
        ingredientId: ingredients.id,
        normalizedName: ingredients.normalizedName,
        family: ingredients.family,
        sourceGroup: ingredients.sourceGroup,
        formType: ingredients.formType,
        isHydrolyzed: ingredients.isHydrolyzed,
      })
      .from(productIngredients)
      .innerJoin(ingredients, eq(productIngredients.ingredientId, ingredients.id))
      .where(eq(productIngredients.productId, id))
      .orderBy(asc(productIngredients.position))

    const saltPosition = findSaltPosition(product.rawIngredientString ?? "")

    return NextResponse.json({
      ...product,
      ingredients: productIngs,
      saltPosition,
    })
  } catch (error) {
    console.error("Error fetching product:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
