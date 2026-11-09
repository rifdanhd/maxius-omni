export default function Loading() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-muted via-muted to-muted px-4 animate-pulse">
      <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/10 blur-3xl" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md items-center justify-center">
        <div className="w-full space-y-6 rounded-3xl border border-border bg-card/80 p-8 shadow-2xl">
          <div className="flex flex-col items-center gap-4">
            <div className="h-24 w-24 rounded-full bg-muted" />
            <div className="h-7 w-44 rounded-md bg-muted" />
            <div className="h-4 w-72 max-w-full rounded-md bg-muted" />
          </div>
          <div className="space-y-5">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-24 rounded-md bg-muted" />
                <div className="h-12 w-full rounded-xl bg-muted/70" />
              </div>
            ))}
            <div className="h-12 w-full rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}
