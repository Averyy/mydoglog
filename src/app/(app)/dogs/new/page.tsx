import { DogForm } from "@/components/dog-form"

export default function NewDogPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Add a dog</h1>
      <div className="mt-6">
        <DogForm />
      </div>
    </div>
  )
}
