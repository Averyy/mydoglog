import { notFound } from "next/navigation"
import { requireDogBySlug, isNextResponse } from "@/lib/api-helpers"
import { DogPageProvider } from "@/components/dog-page-provider"

interface SlugLayoutProps {
  params: Promise<{ slug: string }>
  children: React.ReactNode
}

export default async function SlugLayout({
  params,
  children,
}: SlugLayoutProps): Promise<React.ReactElement> {
  const { slug } = await params
  const result = await requireDogBySlug(slug)

  if (isNextResponse(result)) {
    notFound()
  }

  const { dog } = result

  return (
    <DogPageProvider id={dog.id} name={dog.name} slug={dog.slug} mealsPerDay={dog.mealsPerDay}>
      {children}
    </DogPageProvider>
  )
}
