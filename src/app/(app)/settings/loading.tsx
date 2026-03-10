export default function SettingsLoading(): React.ReactElement {
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <div className="mt-6 space-y-8">
        <section>
          <div className="flex items-center justify-between">
            <div className="h-[1.125rem] w-[4.5rem] animate-pulse rounded bg-muted" />
            <div className="h-8 w-[4.75rem] animate-pulse rounded-md bg-muted" />
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-border bg-card shadow-sm">
              <div className="flex items-start justify-between py-5 px-6">
                <div className="space-y-1">
                  <div className="h-[1.125rem] w-24 animate-pulse rounded bg-muted" />
                  <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
                </div>
                <div className="flex gap-2 shrink-0 ml-4">
                  <div className="h-8 w-[2.75rem] animate-pulse rounded-md bg-muted" />
                  <div className="h-8 w-[4.25rem] animate-pulse rounded-md bg-muted" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
