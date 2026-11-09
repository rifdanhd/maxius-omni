import { cn } from "@/lib/utils";

function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-2">
        <div className="h-7 w-56 max-w-full rounded-md bg-muted" />
        <div className="h-4 w-44 max-w-full rounded-md bg-muted" />
      </div>
      {action && <div className="h-9 w-36 shrink-0 rounded-lg bg-muted" />}
    </div>
  );
}

function StatStrip({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-4 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-20 rounded-xl border border-border bg-card" />
      ))}
    </div>
  );
}

export function DashboardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto max-w-[1400px] space-y-6 p-4 md:p-8 animate-pulse", className)}>
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[132px] rounded-2xl border border-border bg-card" />
        ))}
      </div>
      <div className="h-[420px] rounded-2xl border border-border bg-card" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] rounded-2xl border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}

export function TablePageSkeleton({
  className,
  container = "space-y-4 p-4 md:p-8",
  header = true,
  action = true,
  filters = false,
  stats = 0,
  rows = 6,
  rowClassName = "h-14",
}: {
  className?: string;
  container?: string;
  header?: boolean;
  action?: boolean;
  filters?: boolean;
  stats?: number;
  rows?: number;
  rowClassName?: string;
}) {
  return (
    <div className={cn(container, "animate-pulse", className)}>
      {header && <PageHeaderSkeleton action={action} />}
      {stats > 0 && <StatStrip count={stats} />}
      {filters && <div className="h-14 rounded-xl border border-border bg-card" />}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="h-11 bg-muted/60" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={cn("border-t border-border", rowClassName)} />
        ))}
      </div>
    </div>
  );
}

export function CardsPageSkeleton({
  className,
  container = "space-y-6 p-4 md:p-8",
  header = true,
  action = true,
  cards = 4,
  cardClassName = "h-[132px] rounded-2xl border border-border bg-card",
  gridClassName = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4",
  chartClassName,
  stats = 0,
}: {
  className?: string;
  container?: string;
  header?: boolean;
  action?: boolean;
  cards?: number;
  cardClassName?: string;
  gridClassName?: string;
  chartClassName?: string;
  stats?: number;
}) {
  return (
    <div className={cn(container, "animate-pulse", className)}>
      {header && <PageHeaderSkeleton action={action} />}
      {cards > 0 && (
        <div className={gridClassName}>
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className={cardClassName} />
          ))}
        </div>
      )}
      {chartClassName && <div className={cn("rounded-2xl border border-border bg-card", chartClassName)} />}
      {stats > 0 && <StatStrip count={stats} />}
    </div>
  );
}

export function FormPageSkeleton({
  className,
  container = "mx-auto max-w-4xl space-y-6 p-4 md:p-8",
  fields = 4,
  stepper = false,
}: {
  className?: string;
  container?: string;
  fields?: number;
  stepper?: boolean;
}) {
  return (
    <div className={cn(container, "animate-pulse", className)}>
      <PageHeaderSkeleton />
      {stepper && (
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 w-28 rounded-full border border-border bg-card" />
          ))}
        </div>
      )}
      <div className="space-y-5 rounded-xl border border-border bg-card p-6">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-28 rounded-md bg-muted" />
            <div className="h-10 w-full rounded-lg bg-muted/70" />
          </div>
        ))}
        <div className="h-10 w-36 rounded-lg bg-muted" />
      </div>
    </div>
  );
}

export function MasterDetailPageSkeleton({
  className,
  container = "mx-auto max-w-[1600px] space-y-4 p-4 md:p-6",
}: {
  className?: string;
  container?: string;
}) {
  return (
    <div className={cn(container, "animate-pulse", className)}>
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="h-10 border-b border-border" />
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,390px)_1fr] lg:h-[calc(100vh-17rem)]">
        <div className="space-y-3 rounded-xl border border-border bg-card p-3">
          <div className="h-9 rounded-lg bg-muted/70" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted/60" />
          ))}
        </div>
        <div className="hidden rounded-xl border border-border bg-card lg:block" />
      </div>
    </div>
  );
}

export function DetailPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("min-h-screen animate-pulse", className)}>
      <div className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-border bg-muted px-4">
        <div className="h-8 w-8 rounded-full bg-muted-foreground/20" />
        <div className="space-y-2">
          <div className="h-4 w-40 rounded-md bg-muted-foreground/20" />
          <div className="h-3 w-24 rounded-md bg-muted-foreground/20" />
        </div>
        <div className="ml-auto h-8 w-32 rounded-lg bg-muted-foreground/20" />
      </div>
      <main className="mx-auto max-w-[1400px] px-4 py-5 md:py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <div className="h-56 rounded-xl border border-border bg-card" />
            <div className="h-40 rounded-xl border border-border bg-card" />
          </div>
          <div className="h-[460px] rounded-xl border border-border bg-card" />
        </div>
      </main>
    </div>
  );
}

export function CenteredPageSkeleton({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("flex min-h-[60vh] flex-col items-center justify-center gap-3", className)}>
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  );
}

export function ContentPageSkeleton({
  className,
  container = "mx-auto max-w-5xl space-y-6",
}: {
  className?: string;
  container?: string;
}) {
  return (
    <div className={cn(container, "animate-pulse", className)}>
      <div className="space-y-2">
        <div className="h-8 w-72 max-w-full rounded-md bg-muted" />
        <div className="h-4 w-96 max-w-full rounded-md bg-muted" />
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <div className="h-5 w-40 rounded-md bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 rounded-lg bg-muted/70" />
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={cn("h-4 rounded-md bg-muted", i % 3 === 0 ? "w-2/3" : "w-full")}
          />
        ))}
      </div>
    </div>
  );
}

export function PlaceholderPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[80vh] flex-col items-center justify-center gap-3 animate-pulse",
        className
      )}
    >
      <div className="h-12 w-12 rounded-full bg-muted" />
      <div className="h-6 w-36 rounded-md bg-muted" />
      <div className="h-4 w-56 max-w-full rounded-md bg-muted" />
    </div>
  );
}
