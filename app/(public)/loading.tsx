export default function Loading() {
  return (
    <div className="min-h-screen animate-pulse space-y-16 px-4 py-16 md:px-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="h-12 w-96 max-w-full rounded-lg bg-muted" />
        <div className="h-5 w-64 max-w-full rounded-md bg-muted" />
        <div className="flex gap-3 pt-2">
          <div className="h-11 w-40 rounded-xl bg-muted" />
          <div className="h-11 w-32 rounded-xl bg-muted/70" />
        </div>
      </div>
      {[0, 1, 2].map((section) => (
        <div key={section} className="mx-auto max-w-6xl space-y-4">
          <div className="h-8 w-56 rounded-md bg-muted" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 rounded-2xl border border-border bg-card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
