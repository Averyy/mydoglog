import Link from "next/link"

export default function NotFound(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <h1 className="text-2xl font-bold text-text-primary">Page not found</h1>
      <p className="mt-2 text-sm text-text-secondary">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="mt-4 text-sm font-medium text-primary hover:underline"
      >
        Go home
      </Link>
    </div>
  )
}
