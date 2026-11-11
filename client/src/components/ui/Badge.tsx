import type { ReactNode } from "react";

export type BadgeTone = "success" | "warning" | "error" | "brand" | "sun" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-emerald-100 text-emerald-900 ring-emerald-900/5",
  warning: "bg-amber-100 text-amber-900 ring-amber-900/5",
  error: "bg-red-100 text-red-900 ring-red-900/5",
  brand: "bg-zaio-blue/10 text-zaio-blue ring-zaio-blue/10",
  sun: "bg-zaio-sun/30 text-zaio-ink ring-zaio-ink/5",
  neutral: "bg-zaio-cloud text-zaio-ink/60 ring-zaio-ink/5",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
