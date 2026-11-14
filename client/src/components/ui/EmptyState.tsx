import type { ReactNode } from "react";

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-zaio-cloud bg-zaio-card px-6 py-10 text-center text-sm text-zaio-ink/60">
      {children}
    </p>
  );
}
