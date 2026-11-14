export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="border-b border-zaio-cloud bg-zaio-card px-8 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zaio-ink">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-zaio-ink/60">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
    </header>
  );
}
